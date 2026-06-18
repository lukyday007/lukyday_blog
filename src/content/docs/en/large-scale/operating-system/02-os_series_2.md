---
title: "OS Part 2 — The Evolution of I/O Models: Eliminating the Cost of Finding Work"
description: "The real bottleneck was never throughput. It was the cost of figuring out which connections were ready. From select to epoll, from exhaustive scanning to event notification — operating systems evolved by changing how they search."
sidebar:
  order: 14
date: 2026-06-18
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: June 18, 2026</p>

> In 2024, Discord's engineering team analyzed the WebSocket traffic flowing through their gateway servers. Millions of connections were alive simultaneously, but the vast majority were neither sending nor receiving messages. Discord called them "passive sessions" — connections that existed but did nothing. Once the team stopped sending unnecessary events to these passive sessions, WebSocket traffic dropped by 40%.
>
> The same problem had been documented twelve years earlier. In 2012, WhatsApp engineer Rick Reed presented at Erlang Factory on maintaining 2 million simultaneous connections on a single server. Most of those connections weren't exchanging messages. Users had simply left the app open. The number of messages the server needed to process was small. The number of connections it had to manage was 2 million.

*Reference: [Discord: How Discord Reduced WebSocket Traffic by 40% (2024)](https://discord.com/blog/how-discord-reduced-websocket-traffic-by-40-percent)* <br>
*Reference: [Rick Reed, "Scaling to Millions of Simultaneous Connections", Erlang Factory SF (2012)](https://www.erlang-factory.com/conference/SFBay2012/speakers/RickReed)* <br>
*Reference: [High Scalability: The WhatsApp Architecture (2014)](https://highscalability.com/the-whatsapp-architecture-facebook-bought-for-19-billion/)*

<br>
<br>

The two incidents share a simple truth. The servers didn't slow down because there were too many messages to process. They slowed down because **most connections were doing nothing, yet the server had to keep watching all of them.**

In Part 1, we saw that adding more workers causes coordination costs to explode. This article takes a different path: instead of adding workers, **change how you wait.** The moment engineers recognized that the real bottleneck wasn't throughput but **the cost of finding which connections were ready**, I/O models began evolving in a fundamentally different direction.


<br>

## Out of 10,000 Connections, Who Is Ready?

Imagine a call center with 10,000 agents.

The problem isn't that there are 10,000 customers. Fewer than 100 are actually on a call right now. The other 9,900 are just holding the line, waiting in silence.

Now imagine the floor manager has to walk to each of those 10,000 desks, one by one, and ask:

"Are you on a call right now?"
"How about you?"
"And you?"

By the time the manager finishes the round, more time has been spent *finding* who needs help than actually *helping* anyone.

Servers face the same problem. A large-scale service might hold tens of thousands of connections open at once. But only a tiny fraction are actively sending data at any given moment. The bottleneck isn't how fast the server can process requests. It's **the cost of figuring out which connections need processing right now.**

In Part 1, the bottleneck was coordination cost. More workers meant more management overhead.

This time, the bottleneck is different. It's not about managing the workers. It's about **finding which ones have work to do.**

### How Did We Get Here?

In the early days, this wasn't much of a problem. Servers didn't have to juggle that many connections at once. The simplest solution was to assign a dedicated handler to each connection.

One phone call comes in, one agent picks it up. That agent stays on the line until the call is done.

Servers worked the same way. One connection, one thread.

### Blocking I/O — Frozen While Waiting

The foundation of this approach is **Blocking I/O.**

When you call `read()`, the thread doesn't come back until data arrives. Think of it as an agent waiting for the customer to speak. If the customer says nothing for ten seconds, the agent sits there doing nothing for ten seconds.

The trouble starts when this scales up. 100 connections means 100 threads waiting. 10,000 connections means 10,000 threads waiting.

### The Limits of Thread-per-Request

This one-to-one model — **one thread per connection** — is called **Thread-per-Request** (or Thread-per-Connection). Early Apache was built exactly this way.

On the surface, it seems reasonable. Every connection has a dedicated handler. Easy to manage. But as scale grows, the cracks appear.

Having 10,000 connections doesn't mean 10,000 connections are working at the same time. Most of them are just waiting. Yet the server has to keep a thread alive for every single one. That's where the context switching, lock contention, and cache pollution from Part 1 come back.

But there's a more fundamental problem.

The server is spending enormous effort watching connections that aren't doing anything. In other words, the issue isn't throughput. It's **search cost**.

So the question shifts naturally.

**Instead of watching all 10,000 connections, is there a way to be notified only when one is ready?**


<br>

## Flipping the Direction of Attention

The answer to this question begins with a shift in mindset.

In the Thread-per-Request model, the server **actively monitors every single connection**. "Are you ready?" "How about you?" "And you?" It is a full sweep, checking all 10,000 connections one by one. Most of the answers are "not yet."

What if we flip this upside down? Instead of the server going out to check each connection, the structure is reversed: **the connection notifies the server when it is ready**.

```
[ Traditional Approach: Full Sweep ]

Server ──▶ Connection 1: Ready? → No
Server ──▶ Connection 2: Ready? → No
Server ──▶ Connection 3: Ready? → No
...
Server ──▶ Connection 9,999: Ready? → No
Server ──▶ Connection 10,000: Ready? → Yes!
→ 1 active case found after 9,999 wasted checks

---
[ Shifting the Mindset: Event Notification ]

Connection 10,000 ──▶ Server: "I'm ready"
→ Only the ready connection notifies the server. The rest are ignored.
```

This shift is not just a simple technical optimization. It is an **inversion of attention**. Moving from a structure where the server searches for connections, to one where the connections notify the server when they are active. This idea becomes the foundation of every event-driven system that follows.


<br>

## How the Operating System Notifies Us

The idea is appealing. A ready connection simply notifies the server. But one question remains: 

Who actually knows that a connection is ready, and who does the notifying?

Ultimately, that job belongs to the operating system kernel. The history of how Linux evolved through `select`, `poll`, and `epoll` is a journey of **reducing the cost of finding** those ready connections among tens of thousands of idle ones.

### select — Searching Through Everything

In the 1980s, hardware resources were extremely scarce. Halting an entire process just because a single connection was waiting carried too high of an opportunity cost. 

Before `select` came along, there was no efficient way to monitor multiple connections at the same time. A process either had to stop and wait, or waste CPU cycles constantly checking. `select` changed this by allowing a single execution thread to monitor multiple connections. It was a step forward from Thread-per-Request. 

But the problem was that **it passed the entire list every single time, and scanned the entire list every single time**. If there are 10,000 connections, it does a full sweep of all 10,000 every time it is called. Even if only one connection is ready, you still pay the cost of checking the other 9,999.

### poll — Limits Lifted, but the Structure Remains the Same

As the internet grew, the number of concurrent connections easily surpassed 1,024. `poll` came along and removed `select`'s limit of 1,024 file descriptors (FDs). 

But the real issue was how it actually worked. With every call, `poll` still received the entire list from scratch and scanned it from beginning to end. If `select` was about **"searching through everything to find it,"** `poll` was merely **"now you can search through even more things."** The limit on the search range was gone, but the structure—where the search cost grows in direct proportion to the number of connections—remained exactly the same.

### epoll — A Structure That Only Notifies What's Ready

In 2002, introduced in Linux kernel 2.5.44, **epoll** completely flipped the approach. While `select` and `poll` were built around "searching through everything," `epoll` operates on a different principle: **"Don't search. Register to be notified."**

In an organization, it's like a manager stopping the practice of walking to every employee's desk to ask, "Are you done?" Instead, the manager gives a single instruction: **"Only when your task is finished, drop the document into the shared approval box."** From then on, the manager only needs to check the approval box.

```
[ select / poll ]

Every call:
App ──▶ Kernel: "check these 10,000"
Kernel: walks 1 through 10,000
Kernel ──▶ App: "3 and 7,042 are ready"

→ Cost proportional to total connections. Full scan every time.
---
[ epoll ]

Once:
App ──▶ Kernel: "watch these 10,000" (epoll_ctl)
Every call after:
App ──▶ Kernel: "anything ready?" (epoll_wait)
Kernel ──▶ App: "3 and 7,042" (only ready ones returned)

→ Cost proportional to ready connections. Total count is irrelevant.
```

In `select` and `poll`, the search cost was proportional to the **total number of connections**. If there were 100,000 connections, it had to check 100,000 every single time. In `epoll`, the search cost is proportional to the **number of ready connections**. If only 100 out of 100,000 connections are ready, the server only checks those 100.

In the context of coordination costs discussed in Part 1, `epoll` didn't eliminate coordination costs altogether. Instead, **it changed the baseline for when that cost is triggered.** It ensures that the system only pays a price for the connections that are actually ready to do real work, rather than paying for the entire crowd.


<br>

## Event Loop — An Execution Model That Only Processes What's Ready

If `epoll` is the mechanism that efficiently tells us "who is ready," the **Event Loop** is the execution model built on top of it to process those ready tasks one by one.

Why does the Event Loop depend so heavily on `epoll`? Even the most capable manager would become overwhelmed if they had to personally inspect tens of thousands of departments every day. The Event Loop can operate with a single thread only because `epoll` removes that burden, surfacing only **the work that actually needs attention**. 

The structure is simple. A single thread runs an infinite loop, asking `epoll`, "Is anything ready?" If there are ready connections, it processes them; if not, it waits. This is not a full sweep where the thread digs through tens of thousands of connections one by one. Instead, it simply **harvests the inbox** that `epoll` has already filled up.

```
[ Event Loop ]
loop {
    ready_events = epoll_wait()
    for event in ready_events {
        process(event)
    }
}
→ One thread handles tens of thousands of connections
→ Idle connections are never checked
```

Node.js, Netty, and Nginx all operate based on this model. Their exact execution structures differ slightly—Node.js uses a single thread, while Nginx uses a multi-process event loop. Yet, the core principle is identical: they only look for and process connections that are ready.

So, how big of a difference does this make in a real-world service?

The prime example of this event-driven model's success is Nginx.

### Why Nginx Outpaced Apache

The difference between Apache and Nginx isn’t just a matter of implementation details. The two had entirely different baselines for how they paid their costs.

Apache was structured so that costs grew directly with the number of connections. It had to maintain a thread and memory for every connection, even if no actual requests were coming in. As scale increased, the management cost grew in direct proportion.

On the other hand, Nginx chose a structure where it paid costs based on the number of active events, not the total number of connections. Even if tens of thousands of connections exist, almost no extra cost is incurred if only a few of them are actually active.

Nginx outpaced Apache not because it magically increased concurrency, but because it **eliminated waste**.


<br>

## The Information Processing Cost of Full Sweeps

The problem that kept coming up in Part 2 is simple. 

Only a tiny fraction of connections are actually active, but the system has to check everything just to find those ready ones.

When there are only a few dozen connections, this isn't an issue. But the moment they scale into the tens of thousands, the cost structure changes. The cost of finding *what to process* starts to outweigh the cost of the actual data processing itself.

This is what **search cost** looks like in large-scale systems. When the cost of locating information exceeds the cost of processing it, the system grinds to a halt.

### Herbert Simon’s Bounded Rationality

Interestingly, this isn't just a computer problem. 

Organizations hit a very similar wall as they grow. In a team of 10 people, a CEO can read every single report. But when the company grows to 10,000 employees, the situation changes completely.

Finding *which* report is important becomes harder than making the actual decision itself.

The Nobel laureate Herbert Simon famously noted, "A wealth of information creates a poverty of attention." When the total volume of information to process surpasses a manager's cognitive capacity, overload sets in. This concept is known as **Bounded Rationality**.

**In the end, whether in an organization or a system, what becomes scarce as scale increases is not processing capacity, but attention.**

### Management by Exception and epoll

This is why large organizations give up on full sweeps. Instead of pushing every single report to the top, routine operations are handled on the ground, and only exception cases requiring immediate action are escalated to upper management. This is called **Management by Exception**.

The approach the operating system takes with `epoll` is fundamentally the same.

- Too many connections (Information Overload)
- Cannot scan everything (Bounded Rationality)
- Need a filtering system (Management by Exception)
- Notify only ready connections (epoll)

In other words, the architecture shifted from a structure that monitors everything to one that only receives reports on exceptions. 

The cost didn't disappear. The system simply stopped paying it all the time. Instead of constantly searching through everything, it now pays only when something actually happens.


<br>

## The Bottom Line

The starting point of this part was the realization that a server slows down not because of throughput, but because of the **search cost** of finding who is ready. 

The core solution to this problem was not pouring in more resources, but **shifting the baseline of the cost structure**. Instead of watching the entire pool of connections, the structure was flipped so that costs are paid only for the connections that are ready.

**Costs do not disappear; you can only change the baseline of when they are triggered.** This is the true essence behind the evolution of I/O models—from `select` to `epoll`, and from Blocking to Non-Blocking.

Next up: We've reduced the number of workers and lowered our search costs, but another physical constraint remains. Fast but expensive memory is always scarce, and large but slow disks can't keep up with the processing speed of the CPU. The next topic is one of the operating system's most famous tricks: **pretending it has more memory than it actually does**.

