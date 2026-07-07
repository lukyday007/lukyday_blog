---
title: Why Did I Choose Snowflake ID for Messages?
description: "Why I chose Snowflake ID over Auto-Increment and UUID, and how that decision shaped the concurrency and ordering strategies that followed."
sidebar:
  order: 5
date: 2026-07-01

tags:
  - Snowflake ID
  - UUID
  - Distributed Systems
  - ID Generation
  - Minichat
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: July 01, 2026</p>


## Background — An ID Is Not Just an Identifier

Every message in Minichat is assigned a unique ID when it is created. This ID is not just a value to distinguish one message from another.

Looking at where it is used:

- Sort order for message queries
- `lastReadMessageId` — tracking how far a user has read
- `lastWrittenMessageId` — determining the latest message in a chatroom
- Ordering basis for Kafka Consumer event processing
- Comparison criterion for conditional DB UPDATEs (`WHERE ... < ?`)

The ID serves as the sort key, the freshness indicator, and the concurrency control reference. How it is generated determines the design options available to the rest of the system.


## The Problem — Generating IDs in a Distributed Environment

On a single server, ID generation is straightforward. The database assigns sequential numbers on each INSERT.

But when multiple servers are involved, the problem changes. Each server creates messages simultaneously and must assign IDs independently. A centralized numbering scheme can become a bottleneck, and a collision-free random value loses ordering information.


## Initial Assumption — Familiar Options

I started by reviewing the most familiar approaches.

Auto-Increment delegates ID generation to the database — a well-proven pattern. Sequential ordering and uniqueness are guaranteed by the DB, and implementation is simple. But in an environment where servers scale horizontally, the question shifts:

"Can a single database remain the central point for all ID generation?"

In a distributed environment, each server needs to generate IDs independently. But then, is it enough to simply generate collision-free IDs?


## Analyzing the Data — What Information Should an ID Carry?

The real question was not "how to create a unique ID" but "what meaning should this ID carry."

I defined the requirements for Minichat's message ID.

**1. Does it need to preserve time ordering?**
`lastReadMessageId` and `lastWrittenMessageId` determine freshness by comparing ID values. If the ID does not reflect time ordering, these comparisons break down.

**2. Must it be generated without a central database?**
In real-time chat, multiple servers generate messages concurrently. Routing every ID generation through a single database introduces latency on the generation path.

**3. Must it support numeric comparison?**
It is used directly in conditional UPDATEs like `WHERE last_written_message_id < ?` and Lua Script comparisons like `if ARGV[1] > current`.

In summary, what I needed was not "a collision-free value" but **"a value that can be generated in a distributed environment, preserves time ordering, and serves as a basis for freshness comparison."**


## Trade-off Comparison

| Criterion | Auto-Increment | UUID | Snowflake |
|-|-|-|-|
| Generation location | Database | Application | Application |
| Time ordering | Guaranteed | None | Time-based increase |
| Distributed generation | Difficult | Possible | Possible |
| DB dependency | High | None | None |
| Numeric comparison | Possible | Not possible | Possible |
| Implementation complexity | Low | Low | High |

Auto-Increment is simple but carries DB dependency. UUID enables distributed generation but loses ordering information. Snowflake accepts implementation complexity in exchange for both distributed generation and time-based ordering.


## The Decision — Snowflake ID

In the current project, the ID is not just an identifier — it is used for data comparison and consistency checks. That made Snowflake a suitable choice for this data model. But not every system requires Snowflake.

Snowflake ID structure:
[1-bit sign] [41-bit timestamp] [10-bit nodeId] [12-bit sequence]

Because the timestamp occupies the most significant bits, the value naturally increases as time passes. Within the same millisecond, the sequence increments. Different servers are distinguished by nodeId.

However, if clock drift causes the server clock to move backward, monotonic increase breaks. If this assumption fails, every comparison operation that depends on this ID becomes invalid.


## Implementation

What mattered in the implementation was not the Snowflake algorithm itself, but ensuring that the premise established earlier — **IDs preserve time ordering** — holds at the implementation level as well.

```java
public synchronized long nextId() {
    long currentTimestamp = System.currentTimeMillis() - customEpoch;

    // A backwards clock breaks the monotonic increase premise, so refuse to generate
    if (currentTimestamp < lastTimestamp) {
        throw new RuntimeException("Clock moved backwards. Refusing to generate id.");
    }

    if (currentTimestamp == lastTimestamp) {
        sequence = (sequence + 1) & SEQUENCE_MASK;
        if (sequence == 0) {
            // If 4096 IDs are exhausted within the same millisecond, wait for the next one
            currentTimestamp = tilNextMillis(lastTimestamp);
        }
    } else {
        sequence = 0L;
    }

    lastTimestamp = currentTimestamp;

    return currentTimestamp << (NODE_ID_BITS + SEQUENCE_BITS)
            | (nodeId << SEQUENCE_BITS)
            | sequence;
}
```

Setting a custom epoch of 2025-01-01 gives the 41-bit timestamp a lifespan of roughly 69 years.

Clock drift was initially handled by waiting, but I switched to refusing generation, judging that failing fast is operationally sounder than an unbounded wait.


## Validation

### Test 1: Same nodeId, Multi-threaded Concurrent Generation

10 threads simultaneously generated 1,000 IDs each from a single Snowflake instance — 10,000 total.

| Metric | Value |
|-|-|
| Total generated | 10,000 |
| Unique IDs | 10,000 |
| Duplicates | 0 ✅ |

`synchronized` prevents sequence collisions within the same millisecond.

### Test 2: Different nodeIds, Concurrent Generation

nodeId 1 and nodeId 2 each generated 5,000 IDs simultaneously — 10,000 total.

| Metric | Value |
|-|-|
| Total generated | 10,000 |
| Unique IDs | 10,000 |
| Collisions | 0 ✅ |

Even when generated in the same millisecond, different nodeIds produce different bit compositions, eliminating collisions.
Node 1: timestamp=22:43:22.057, nodeId=1, seq=0

Node 2: timestamp=22:43:22.057, nodeId=2, seq=2852
→ Same timestamp, different IDs

### Test 3: Monotonic Increase Verification

10,000 IDs generated sequentially. Every ID was confirmed to be greater than its predecessor.

| Metric | Result |
|-|-|
| Monotonic increase | ✅ All 10,000 IDs greater than previous |
ID                     Timestamp                  NodeId  Seq

197708594001481728     2026-06-30 22:43:22.058         1    0

197708594001481729     2026-06-30 22:43:22.058         1    1

197708594001481730     2026-06-30 22:43:22.058         1    2

...

197708594009872141     2026-06-30 22:43:22.060         1  1805

197708594009872142     2026-06-30 22:43:22.060         1  1806

197708594009872143     2026-06-30 22:43:22.060         1  1807

Within the same millisecond, the sequence increments. When the millisecond changes, the sequence resets. Comparing ID values is equivalent to comparing time order.


## What This Decision Made Possible

The design decisions covered in this series all depend on a single property that Snowflake ID provides:

**Message IDs increase as time passes.**

This property shaped how consistency and ordering were handled across the system.

| Part | Dependent assumption | Decision it enabled |
|-|-|-|
| Part 1 | IDs increase monotonically → max comparison possible | Lua Script instead of distributed lock |
| Part 2 | IDs increase monotonically → ordering reversal absorbed | Kafka Key removed for user-chat-update |
| Part 3 | Different consistency requirements per read | Replica Routing |
| Part 4 | Permanent bans stored in DB → fallback possible on Redis failure | Fail-Partial strategy |

In Part 1, I wrote "Snowflake ID increases monotonically, so this is a max problem." In Part 2, I wrote "conditional UPDATE absorbs ordering reversal." The starting point for both was the ID generation strategy.

If UUID had been chosen, time ordering could not be determined from the ID alone — separate sort criteria or version management would have been necessary. If Auto-Increment had been chosen, the database would have become a bottleneck in a distributed environment.

The initial ID design opened up the options for concurrency control, ordering guarantees, and failure response strategies that followed.


## Conclusion

ID generation was not simply a matter of creating collision-free values. In Minichat, the ID serves as both the sort key and the consistency reference. That is why I chose Snowflake — to maintain time ordering even in a distributed environment. This decision became one of the foundations behind the concurrency and ordering strategies discussed in this series.