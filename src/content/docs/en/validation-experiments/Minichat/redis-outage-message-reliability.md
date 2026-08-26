---
title: Can We Keep Messages Alive When Redis Goes Down?
description: "Injecting a Redis outage to verify message loss and the effectiveness of failure-handling strategies."
sidebar:
  order: 3
date: 2026-08-26

tags:
  - Performance Testing
  - Redis Outage
  - Load Testing
  - Circuit Breaker
  - Minichat
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: Aug 26, 2026</p>


## Background

As mentioned in an earlier post, only Minichat's chat server (the Spring server) runs as multiple instances. Session information — which room a user is in, which server they're connected to — is managed centrally through Redis. On top of that, processing a single message goes through several pieces of Redis-dependent logic.

In the message-sending flow, there are two paths that have to go through Redis.

```
Message intake:
- RateLimit check
- Look up the current user's chatId

Message delivery:
- Look up room members
- Look up each user's server location (MGET)
```

With this much dependency on a single Redis, how badly would the service be affected if Redis went down? We had some protection in place with try-catch, but the failure-handling code wasn't complete — so this time I decided to verify the failure handling itself.

There were two things I wanted to confirm.
One, what exactly happens when Redis dies.
Two, whether the defensive code (Fail-Open) I'd added to prevent that actually works.

## Experiment Method

Let me start with how I measured things. Numbers like "150 messages disappeared" show up later, and knowing how those numbers were derived makes the rest of the post easier to follow.

For this experiment, I used Docker to stop Redis for 60 seconds, injecting an outage artificially.

### Load Conditions

| Item | Value |
| --- | --- |
| App servers | 2 |
| Users | 150 (k6 VU 150) |
| Chat room | 1 (all users join) |
| Sending | 1 message/sec per VU (~150/sec = ~9,000/min) |
| Test duration | 6 minutes |
| Fault injection | During load: `docker stop redis` → hold 60s → `docker start redis` |

Every stage was measured under the same load and the same Redis fault-injection conditions.

### How Message Loss Was Measured

I did not judge message loss by k6's WebSocket receive count. Instead, I directly compared the row count of the `messages` table before and after the test.

```
① Record messages COUNT before the test
        ↓
② Start k6 load
        ↓
③ docker stop redis  (60s outage)
        ↓
④ docker start redis
        ↓
⑤ After k6 ends, wait until Kafka finishes processing
        ↓
⑥ Re-measure messages COUNT
        ↓
⑦ Compare DB increase vs. k6 sent count
```

One thing to note: by design, creating a room automatically generates one **system message** like "So-and-so has joined." Since that isn't sent by a user, it's excluded from the comparison.

In the later re-run with Timeout + Fallback applied, the measurements were as follows.

```
k6 messages sent    = 13,350
messages increase   = 13,351
system message      = 1
user message increase = 13,351 - 1 = 13,350

→ 13,350 = 13,350  (0 loss)
```

The 13,350 messages sent by k6 matched the 13,350 user messages stored in the DB, so no message loss occurred in that experiment.

### Checking Kafka LAG

I also checked the state of the Kafka consumer group.

```
$ kafka-consumer-groups --bootstrap-server localhost:9092 --describe --group chat-group

CURRENT-OFFSET   LOG-END-OFFSET   LAG
   (equal)          (equal)         0
```

The gap between `CURRENT-OFFSET` (where the consumer has processed up to) and `LOG-END-OFFSET` (the last position written to the topic) — the **LAG — was 0**. So at the end of the test, there were no messages left unprocessed in Kafka.

The final verdict on message loss was based not on Kafka LAG but on the stored row count in the `messages` table. **Kafka LAG tells you whether messages are piling up in Kafka; the DB COUNT tells you whether messages ultimately got stored.** I used them for those two separate purposes.


## Root Cause

This server already had Fail-Open code to work around Redis outages. It wrapped Redis calls in `try-catch`, and when an exception occurred, it bypassed the Redis-dependent logic and kept going.

```java
// simplified from the actual implementation
try {
    redisTemplate.execute(...);   // Redis lookup
} catch (Exception e) {
    log.error(...);               // caught here on failure
}
return joinPoint.proceed();       // message processing continues
```

But in an actual outage, this defensive code didn't kick in quickly. The reason was that it took too long to even reach the `catch`.

While Redis was down, Redis commands didn't fail immediately — they waited for a response up to the command timeout. Because *Lettuce's default command timeout is 60 seconds*, when the outage hit, a command would wait up to 60 seconds before a timeout exception was thrown.

*Reference: [Redis Lettuce Ref](https://redis.github.io/lettuce/user-guide/connecting-redis/)*

```
Redis stops
   ↓
no immediate exception
   ↓
wait until command timeout (60s)
   ↓
only then, exception
   ↓
catch is reached
```

In other words, it wasn't that Fail-Open was missing — it was that 60 seconds had to pass before Fail-Open could run. Since `try-catch` only executes after an exception is thrown, it couldn't do its job of quickly bypassing the Redis outage.

On top of that, the message intake path also had Redis-dependent logic in several places. When Redis stopped responding, these calls sat waiting on timeouts, and message intake itself slowed down. As a result, the DB write rate during the outage dropped from a normal ~9,000/min to ~1,500/min.

### Checking the Metrics

Even though Redis was down for 60 seconds, the HTTP request failure rate was **0%**, and WebSocket connections stayed up. k6's delivery latency also only measures messages that were actually received, so it couldn't reveal the message loss itself.

But when I compared k6's sent count against the DB's actual stored count after the test, there was a **difference of 150**.

Why did loss that didn't show up in the metrics still happen?

Looking at the test setup, k6 only measures delivery latency when it receives a message over the WebSocket.

```JavaScript
socket.onmessage = (e) => {
    received.add(1);

    ...

    if (inner.t) {
        deliveryLatency.add(Date.now() - inner.t);
    }
};
```

So the measurement structure is:

```
send → message arrives → measure delivery latency
```

If a message never arrives, its delivery latency is never measured at all. Looking only at delivered messages, latency can appear normal — but **you can miss the fact that some messages were never processed**.

In this test, the Kafka consumer LAG came out to 0, while the DB stored 150 fewer than k6 sent. From this, I concluded that the messages weren't left unprocessed in Kafka; rather, **some messages failed to be taken in during the Redis outage window**.

| Metric | Value |
| --- | ---: |
| k6 messages sent (app_msgs_sent) | 58,350 |
| DB messages stored | 58,201 |
| System message (auto-created on room creation) | 1 |
| User messages stored | 58,200 |
| Difference from sent (loss) | **150** |
| Kafka LAG | 0 |

Since LAG was 0, no messages were left unprocessed in Kafka at the end of the test.

Meanwhile, k6 sent 58,350 and the DB stored 58,200 user messages.

I took these 150 to be messages that weren't sitting in Kafka, but rather failed to get processed before being published to Kafka.

### DB Write Rate Over Time

Looking at the per-minute message write rate makes the impact of the Redis outage even clearer.

| Time | Writes/min | Situation |
| --- | ---: | --- |
| 14:32 | 9,000 | Normal |
| 14:33 | **1,500** | **Redis down** |
| 14:34 | **16,350** | **Redis recovered** |
| 14:35 | 9,000 | Normal |
| 14:36 | 9,000 | Normal |
| 14:37 | 8,850 | Normal |

Normally about 9,000 messages were stored per minute, but at 14:33 when the Redis outage hit, it **dropped to 1,500** — roughly 17% of normal throughput.

At 14:34, right after Redis was restarted, **16,350** were stored, a temporary spike above the outage window, before settling back to around 9,000.

In other words, at 14:33 (outage) about 7,500 fewer were stored than normal, and at 14:34 (recovery) writes jumped to 16,350. It looks like a good portion of the messages that couldn't be processed during the outage got processed in a burst right after recovery.

The difference that ultimately remained was 150.


## Shorter Timeout + Fallback

I fixed two things.

- Reduced the Redis response wait (command timeout) from **60s → 2s**. Now when Redis dies, a timeout exception fires after 2 seconds.
- On a failed Redis lookup, made it **fetch the information from somewhere else**. Added fallbacks so the user's chatId comes from the session cache, and room member info comes from the DB.

```
Redis fails
   ↓
timeout after 2s
   ↓
look up from session cache / DB
   ↓
message processing continues
```

The actual load test results were as follows.

| Metric | Before failure handling | Timeout + Fallback |
| --- | ---: | ---: |
| Message loss | 150 | **0** |
| DB writes during outage | 1,500 (17% of normal) | **6,450 (72% of normal)** |
| Delivery success rate | 99.74% | **100%** |
| p95 latency | 54.66s | **54.54s** |

With the fallback added, message loss dropped from 150 to **0**, and the DB write rate during the outage recovered from 17% to **72%** of normal.

But the p95 latency **barely moved — from 54.66s to 54.54s.**


## Repeated Timeouts

Something was off.

**I cut the timeout from 60s to 2s, so why is p95 still 54.54s?**

I'd assumed 2 seconds was fast enough to fail quickly and fall through to the fallback. But processing a single message doesn't call Redis just once.

```
Message processing
   ↓
Redis call ① → wait 2s → fail → fallback
   ↓
Redis call ② → wait 2s again → fail → fallback
   ↓
Redis call ③ → wait 2s again → fail → fallback
...
```

Even after we'd already confirmed Redis was down, the next Redis call would still reach out to Redis and wait on the timeout again.

So while the outage lasted, the same timeout cost was being paid over and over across multiple Redis calls.

Then — once we've confirmed Redis is down, couldn't we just avoid calling Redis at all for a while?


## Applying a Lightweight Circuit Breaker

For this, I implemented a simple circuit breaker directly, without any external library, that blocks Redis calls for a set period.

So when a Redis call fails, I changed it to **block further Redis calls for a while and fall straight through to the fallback**.

```
First Redis failure
      ↓
Record a block-until time (now + 5s)
      ↓
For the next 5s: skip the Redis call → straight to fallback
      ↓
After 5s, try Redis once more
      ↓
Success → back to normal / Failure → block again
```

This way, there's no need to wait 2 seconds per request while the outage persists.

```
[After the lightweight circuit breaker]

Request 1 → Redis → fail → fallback
Request 2 → no Redis call → fallback
Request 3 → no Redis call → fallback
Request 4 → no Redis call → fallback
...

after 5s
Request N → retry Redis
```

The implementation uses no external library — it just stores a **block-until time in an `AtomicLong`**, a lightweight circuit breaker built by hand.

If the block-until time hasn't passed, it skips Redis and goes straight to the fallback; once the time passes, it retries Redis.


## Results by Circuit Breaker Stage

So how much does applying a circuit breaker at each Redis call site actually improve things?

I added a circuit breaker at one Redis call site at a time, injecting the same Redis outage repeatedly, and measured the change in p95.

| Stage | Applied at | p95 |
| --- | --- | ---: |
| ② | Fallback only (no breaker) | 54.54s |
| ③ | Room member lookup + server location MGET | 49.4s |
| ④ | RateLimit Lua execution | 32.12s |
| ⑤ | User chatId lookup | **31.8s** |

As the circuit breaker's coverage widened, p95 fell from 54.54s → 49.4s → 32.12s → 31.8s.


## The Principle for Handling Failures

For this failure handling, I chose the following principle.

**During a Redis outage, give up some real-time delivery if needed, but prevent message loss.**

I did not set out to deliver every message in real time during a Redis outage.

When Redis stops, we can't look up the user's server location stored in Redis. So when the server location can't be determined, I made it prioritize storing to the DB over real-time delivery.

```text
Redis outage
   ↓
can't determine the user's server location
   ↓
don't deliver to remote users immediately
   ↓
store the message in the DB
   ↓
recover through client reconnection or DB lookup
```

In the end, this experiment prioritized message preservation over real-time delivery. Delivery latency can be recovered after the outage ends, but a message that was never stored in the DB can't be recovered later.


## Wrapping Up

This experiment left me with two takeaways.

First, **monitoring metrics alone may not be enough to detect a failure.**

Nothing showed up in the HTTP request failure rate or WebSocket connection state, yet 150 messages were never stored in the DB. In the end, I didn't stop at reading the metrics — I confirmed the problem by directly comparing the sent count against the final stored count.

Second, the biggest thing I felt in this experiment was that keeping every feature fully working during a failure isn't always the best choice.

During the Redis outage, I prioritized leaving messages in the DB over keeping real-time delivery alive, and when needed, the service could route around it through client reconnection or a DB lookup.

It was a genuinely eye-opening test. In the past, I mostly thought about which technology to pick to solve a problem. But in this experiment, I learned that during a failure you also have to decide **what to prioritize, what to give up, and how to compensate for what you gave up.**