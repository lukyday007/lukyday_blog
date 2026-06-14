---
title: "OS Part 1 — Why Servers Slow Down: The Real Cost of Concurrency"
description: "When a server slows down, the first question an engineer should ask is not 'Is the CPU overloaded?' It is 'What is the CPU waiting for?' Concurrency is never free. Every additional worker comes with a coordination cost."
sidebar:
  order: 13
date: 2026-06-15
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: June 15, 2026</p>

> In 2025, a production server started receiving 10,000 requests per minute. Response times shot from 200ms to over 40 seconds. The engineering team increased the connection pool from 50 to 100, then to 150. Nothing improved. CPU utilization sat at just 20%, yet a thread dump revealed that most threads were stuck in TIMED_WAITING — doing absolutely nothing.
>
> The same pattern had been documented 25 years earlier. In 1999, Dan Kegel posed the question that would define a generation of server architecture: "Can a single server handle 10,000 concurrent connections?" Apache assigned one process per connection. It worked fine for a few hundred. But once connections reached the thousands, the CPU began spending more time managing process switches than serving actual requests.

*Reference: [Thread Pool Bug: 200ms to 40s Timeouts (2025)](https://medium.com/@ashish.tripathy38/the-thread-pool-bug-that-turned-200ms-responses-into-40-second-timeouts-6ddab8db5065)* <br>
*Reference: [Dan Kegel, "The C10K Problem" (1999)](http://www.kegel.com/c10k.html)* <br>
*Reference: [Cloudflare: Why We Chose NGINX](https://blog.cloudflare.com/the-problem-with-event-loops/)*

<br>
<br>

A quarter-century separates these two incidents, but they hit the same wall. The intuition that more workers means more output — in practice, it was the very thing that brought the system down.

In the database series, we traced disk I/O, indexes, transactions, and distributed systems along a single thread: costs never disappear. Operating systems take that principle and push it further — they **hide costs, defer them, and act as though they don't exist.** One CPU appearing to juggle thousands of tasks at once. Behind that act is an enormous coordination effort, and the price of sustaining it.

This article is about the point where that coordination cost overtakes the work itself.


<br>

## Why Servers Actually Slow Down

When a factory falls behind on orders, hiring more workers is common sense. But in both incidents above, that common sense collapsed. More workers made things worse, not better.

And the strangest part: CPU utilization was only 20%. The workers weren't overloaded. They weren't even busy. So what was actually causing the slowdown?

### Computing vs. Waiting

A computer only ever does two things with its time: **compute, or wait.**

The CPU wasn't refusing to work. It was spending most of its time waiting — with nothing to do.

If the workload is constant computation — video encoding, encryption, ML training — then **CPU speed** is the bottleneck. Adding more workers hits a physical wall. This is a **CPU Bound** workload.

But most servers look nothing like that. A request arrives, the server queries a database, calls an external API, reads from disk. During all of that, the CPU sits idle. The bottleneck isn't computation. It's **waiting.** This is an **I/O Bound** workload.

```
[ CPU Bound ]

CPU ████████████████████████████  (computing 100%)
I/O                                (waiting 0%)
→ CPU is the bottleneck. A faster processor is the answer.

---
[ I/O Bound ]

CPU ██░░░░░░██░░░░░░██░░░░░░██  (computing 20%)
I/O   ██████   ██████   ██████   (waiting 80%)
→ Waiting is the bottleneck. The CPU is mostly idle.
```

Most real-world web servers fall into the second category. The CPU computes for a tiny fraction of each request. The rest is **waiting.**

That's what happened to the production server from the 2025 incident. Its threads were locked in TIMED_WAITING. The CPU wasn't idle by choice — **it had no work to pick up.**

Ironically, this is also what gives the operating system its trick. Because the CPU spends most of its time waiting, there is room for a trick — fill those idle gaps with other work, and make it look like everything runs at once.

**Is the CPU computing, or waiting?** That question determines every design decision that follows.


<br>

## The Paradox of Adding Workers

When a server slows down, adding threads feels like the obvious fix. More workers, more throughput.

But as the number of workers grows, the system becomes less productive, not more. Eventually, more resources are spent coordinating work than performing it.

### The First Cost: The Weight of Shift Changes

Physical cores are finite. Pack thousands of threads onto a handful of cores, and **each worker gets a vanishingly small slice of time at the workbench**. The OS must constantly rotate workers in and out.

This is where the first cost appears. Before a worker can hand over the workstation, they must record exactly where they left off. The incoming worker must then reload that state and figure out where to continue.

As more workers are added, a growing share of the factory's resources is spent preparing for handovers rather than doing actual work. Eventually, the workers stop producing and spend most of their time updating paperwork.

The operating system calls this **context switching.**

```
[ Context Switch ]

Thread A running ──▶ [save state] ──▶ [restore state] ──▶ Thread B running
        │                  │
        └── this window ───┘
       "zero useful work done"
```

### The Second Cost: Contention Over Shared Resources

But the cost doesn't stop at shift changes. When workers share the same workspace, a second overhead stacks on top.

Two workers modifying the same data simultaneously corrupts it. To prevent this, the system enforces exclusive access: one worker at a time. This is a **lock.**

```
[ Lock Contention ]

Thread 1 ──▶ [lock acquired] ──▶ working ...
Thread 2 ──▶ [waiting ─────────────────▶] ──▶ lock acquired
Thread 3 ──▶ [waiting ──────────────────────────────▶] ──▶ lock acquired
Thread 4 ──▶ [waiting ─────────────────────────────────────────▶]

More threads ↑  →  longer queues ↑  →  less concurrency benefit ↓
```

More workers, longer lines. The workers hired to boost throughput end up standing in queues. This gridlock stacks on top of context switching.

### The Third Cost: Spilling Into Hardware

The first two costs are software-level coordination problems. But when worker counts grow large enough, the damage reaches **hardware.**

CPUs keep frequently used data in high-speed caches near the core. When workers rotate too quickly, each new worker finds the cache filled with the previous worker's data — useless. They must reload from main memory, which is far slower. As threads multiply, this reloading compounds. The CPU spends more time fetching data than computing. This is what **cache misses** look like at scale.

### The Inversion Point

At first, more threads means more throughput. But past a certain point, each new thread costs more to coordinate than the work it produces.

```
Throughput
▲
│          ┌─── peak
│         /│
│        / │
│       /  │
│      /   │    ＼
│     /    │      ＼
│    /     │        ＼  ← coordination cost > actual work
│   /      │          ＼
│  /       │
└─────────────────────────▶ Thread count
            Beyond the optimum:
            more threads = less throughput
```

Past the peak, **context switching, lock contention, and cache pollution** overwhelm useful work. CPU utilization hits 100%. The server looks maximally busy. But very little useful work is actually getting done.

**A busy CPU and a productive CPU are not the same thing.**


<br>

## Does Adding People Make Things Faster?

In 1975, Frederick Brooks analyzed why the most intuitive fix for a late software project always backfires. When deadlines slip, managers add people. But adding people makes the project later.

The reason: as the team grows, the time spent **aligning with each other** rises faster than the time spent working. With $n$ people, communication paths explode as $n(n-1)/2$.

*Reference: [Frederick Brooks, "The Mythical Man-Month" (1975)](https://en.wikipedia.org/wiki/The_Mythical_Man-Month)*

```
[ The Explosion of Communication Paths ]
3 people  →  3 paths
A────B
╲    │
 ╲   │
  ╲  │
    C

5 people  →  10 paths
A───B
│╲ ╱│
│ ╳ │    
│╱ ╲│
C───D
 ╲ ╱
  E  

10 people →  45 paths ...
```

### The Mythical Man-Month, OS Edition

This organizational law operates at the operating system level just the same. Adding a thread gains one worker. But the moment that worker competes for shared resources, coordination cost rises with it.

```
[ The Mythical Man-Month, OS Edition ]

Threads       Productive Work       Coordination Overhead
4             85%                   15%
16            60%                   40%
64            30%                   70%
256           10%                   90%
```

Adding threads to a struggling server is the equivalent of throwing developers at a late project. Past the tipping point, more threads means less throughput.

### The Constraint That Never Goes Away

In the database series, we saw how individually rational transactions can collectively paralyze a system — the fallacy of composition. Thread pools follow the same law.

Every strategy that increases concurrency by adding workers carries a cost that scales with the number of workers: **coordination cost**. Costs never disappear. Execution units have grown lighter over the decades. The coordination cost itself has never been eliminated.


<br>

## Three Responses to the Same Constraint

Coordination cost cannot be eliminated. So how has the industry tried to contain it?

If the CPU is idle, fill the gap with other work. That's the premise of **concurrency.** The real question is how to do it without letting coordination costs devour the gains. The answer came in three stages — each sacrificing something different in exchange for lower overhead.

### Processes — Safety at Maximum Cost

The first priority was safety. One task crashes, the rest must survive. That demands hard boundaries.

A **process** gives each task its own memory, its own file table — a completely independent workspace.

```
[ Process ]
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Process A   │   │  Process B   │   │  Process C   │
│  ┌────────┐  │   │  ┌────────┐  │   │  ┌────────┐  │
│  │ Memory │  │   │  │ Memory │  │   │  │ Memory │  │
│  └────────┘  │   │  └────────┘  │   │  └────────┘  │
│  Code        │   │  Code        │   │  Code        │
│  Stack       │   │  Stack       │   │  Stack       │
│  File Table  │   │  File Table  │   │  File Table  │
└──────────────┘   └──────────────┘   └──────────────┘
 Full isolation     Full isolation     Full isolation
```

This **isolation** is how Nginx survives a worker crash without losing the entire service.

But isolation is expensive. Independent memory spaces, the heaviest **context switches** of any execution unit. Maximum safety. Maximum coordination cost.

### Threads — Trading Safety for Speed

If maintaining separate workspaces costs too much, what if workers shared one? That's the tradeoff behind the **thread**. 

Same heap, same code — only the stack is separate.

```
[ Thread ]
┌──────────────────────────────────────┐
│               Process A              │
│                                      │
│   ┌──────────────────────────────┐   │
│   │      Shared Memory (Heap)    │   │
│   └──────────────────────────────┘   │
│                                      │
│  ┌────────┐  ┌────────┐  ┌────────┐  │
│  │Thread 1│  │Thread 2│  │Thread 3│  │
│  │ Stack  │  │ Stack  │  │ Stack  │  │
│  └────────┘  └────────┘  └────────┘  │
└──────────────────────────────────────┘
     Shared memory, separate stacks
```

No duplication means far cheaper creation and switching. This is why Java thread pools became the standard for high traffic.

But sharing breeds conflict. Concurrent modifications corrupt data. One worker's fatal error brings down the entire workspace. The cost of being lightweight: **isolation is gone.**

### Coroutines — Moving the Cost Out of the OS

Even threads hit a wall at tens of thousands of concurrent connections. Each thread still consumes hundreds of kilobytes of memory, and **the OS scheduler's switching overhead** across all of them creates a hard ceiling.

The question: can you get massive concurrency without paying the OS-level coordination tax?

Coroutine-based systems answered by moving scheduling into the **application runtime.** Go's goroutines run hundreds of thousands of lightweight workers on just a few hundred OS threads. Java 21's Virtual Threads follow the same approach.

```
[ Thread ]

Thread A ──▶ OS Scheduler ──▶ Thread B

The OS decides when to switch, whether the thread is ready or not.

---
[ Coroutine ]

Coroutine A ──▶ suspend
                    │
                    ▼
         Application Scheduler
                    │
                    ▼
                Coroutine B

Execution only transfers when the coroutine voluntarily yields.
```

This is the first trick in our operating system series. A CPU core still executes only one task at a time. But whenever a task blocks on I/O, it gives up its turn and another takes its place. To the outside observer, it appears as **though hundreds of thousands of tasks are running simultaneously**.

To make that possible, goroutines and virtual threads place a lightweight scheduler on top of a small pool of OS-managed threads. The operating system continues to manage only a limited number of kernel threads, while the application runtime handles the scheduling of vast numbers of lightweight coroutines.

But the cost never disappeared. Part of the coordination work once handled by the operating system has simply been pushed into **the application runtime**.


### The Spectrum

| Execution Unit | What You Gain | What You Lose | Example |
|--|--|--|--|
| Process | Full isolation | Heaviest creation and switching costs | Nginx workers |
| Thread | Lightweight switching, shared memory | No isolation, shared-resource conflicts | Java thread pools |
| Coroutine | Extreme lightness, minimal switching cost | Depends on cooperative yielding; blocking calls stall everything | Go Goroutines, Java Virtual Threads |

These three are not a technological progression. They are **successive attempts to contain the same constraint.** Costs never disappear. From processes to threads to coroutines, only the shape of the cost changed.


<br>

## The Bottom Line

Servers slow down for one of two reasons: the CPU is busy computing, or stuck waiting. Most web servers fight the second problem.

To fill those waiting gaps, operating systems evolved progressively lighter execution units. Each made concurrency cheaper to achieve. None made coordination free. Context switching, lock contention, and cache pollution scale with every worker added.

The real challenge was never making the CPU busier. It was filling idle time with useful work **without letting coordination costs consume the gains.**

**Making a CPU busy is easy. Making it productive is the hard part.**

Next: What if, instead of adding more workers, you changed how they wait? The next article explores the shift from blocking to non-blocking, from select to epoll — **the evolution of I/O models that eliminate idle time.**