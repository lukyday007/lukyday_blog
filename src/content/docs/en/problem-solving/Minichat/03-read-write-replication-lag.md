---
title: Choosing Consistency After Read/Write Splitting
description: "After splitting reads and writes across Master and Replica, replication lag means the same query can return different data depending on where it runs. The real question is which reads actually need freshness."
sidebar:
  order: 3
date: 2026-06-26

tags:
  - Database
  - Read/Write Splitting
  - Replication
  - Replication Lag
  - Consistency
  - Minichat
---


<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: June 26, 2026</p>


## Background — Read/Write Splitting

In Minichat, read requests far outnumber writes. Chatroom list queries, message lookups, user profile fetches — most APIs are read operations.

To offload read traffic from the Master, I implemented DataSource Routing. Transactions marked with `@Transactional(readOnly = true)` are routed to a Replica; everything else goes to the Master. The setup is one Master and three Replicas.


## The Problem — Replication Lag

Data written to the Master takes time to propagate to Replicas.

If a user sends a message and immediately opens the chatroom list:

```
Message sent → Master UPDATE (lastWrittenMessageId = 170)
↓
Chatroom list query → @Transactional(readOnly = true) → Replica
↓
Replica has not yet replicated → returns lastWrittenMessageId = 150
↓
Latest message does not appear in the list
```

Because the write and the read hit different databases, data is inconsistent for the duration of the replication lag. The user performed an action but cannot see its result.


## Validation — Reproducing Read Inconsistency Under Replication Lag

To confirm that replication lag actually produces different read results, I ran a test against a real Master-Replica environment.

**Test Setup**
- Master: localhost:3301
- Replica: localhost:3307, 3308, 3309
- MySQL Replication (GTID-based)

**Scenario: Artificially induce lag by stopping the Replica's SQL_THREAD**

1. Initial state: Master and Replica hold identical data
2. Stop Replica's SQL_THREAD → replication pauses
3. UPDATE `lastWrittenMessageId` on Master
4. Query both sides and compare
5. Restart SQL_THREAD → re-query after replication catches up

### Results

| Step | Query target | Returned value | Status |
|-|-|-|-|
| After Master UPDATE | Master | 170 | Fresh |
| After Master UPDATE | Replica | 124000000000010000 | Stale — pre-update value |
| After SQL_THREAD restart | Master | 170 | Fresh |

After updating `lastWrittenMessageId = 170` on the Master, querying the Replica at the same moment returned the pre-update value. In an environment where `@Transactional(readOnly = true)` routes to a Replica, users see stale data for as long as the replication lag persists.

Once the SQL_THREAD was restarted, the Master's changes propagated and both sides returned the same value. The inconsistency is not permanent — it exists only within the lag window. But during that window, user experience is not guaranteed.


## Initial Assumption — Route All Reads to Master

The most obvious fix was to send all reads to the Master. Replication lag disappears entirely.

But that defeats the purpose of having Replicas. All traffic concentrates on a single node, and the original goal — offloading read load — is nullified.

Before choosing a consistency strategy, I stepped back and examined the nature of the read requests themselves.


## Analyzing the Data — Not every read is about freshness.

Not all reads require the same level of consistency.

**Data that demands immediate freshness:** A message the user just sent, the chatroom's latest message, read status. These are direct results of the user's own actions. Any delay is immediately noticeable and breaks the experience.

**Data that tolerates delay:** Profile information, search results, user lists. If replication lags by a few hundred milliseconds, the user does not notice.

**Different reads have different consistency requirements.** Applying the same strategy to all of them either over-pays for freshness or under-delivers on user experience.


## Trade-off Comparison

I compared strategies for handling replication lag.

| Strategy | Data freshness | Implementation complexity | Master load |
|-|-|-|-|
| Master-only reads | Always guaranteed | Very low | Very high (Replica becomes useless) |
| Replica reads | Not guaranteed | Low | Low |
| Sticky Read | Mostly guaranteed | Medium | Medium |
| Read-after-write | Guaranteed | High | Medium |

**Master-only reads:** Freshness is guaranteed, but read load distribution disappears.

**Replica reads:** Load is distributed, but stale data may be returned during replication lag.

**Sticky Read:** All reads are routed to Master for a fixed time window (e.g. 2 seconds) after a write.

**Read-after-write:** Only the specific read that follows a write is routed to Master.


## The Decision

### Current Choice — Replica Routing

Minichat currently applies only DataSource Routing based on `@Transactional(readOnly = true)`. Writes go to Master, reads go to Replica.

```java
@Override
protected Object determineCurrentLookupKey() {
    if (TransactionSynchronizationManager.isCurrentTransactionReadOnly()) {
        return masterReplicaKeyRouter.getReplicaKey();
    }
    return masterReplicaKeyRouter.getMasterKey();
}
```

Sticky Read and Read-after-write are not implemented. At the current project scale, not every read requires immediate freshness, so Replica Routing is sufficient.

### Future Considerations — Read-after-write vs Sticky Read

If the service scales or if more APIs require immediate visibility of a user's own writes, the read strategy will need to evolve. Two strategies are worth considering.

**Read-after-write**

Only the specific reads that follow a user's write are routed to Master. All other reads remain on Replica.

```java
// pseudo code
if (hasRecentWrite(userId)) {
    return masterDataSource;   // user's own write just happened → Master
}
return replicaDataSource;      // everything else → Replica
```

In a chat system, this means: chatroom list query immediately after sending a message goes to Master. A friend list query at the same moment stays on Replica.

This minimizes Master load while precisely covering the user experience gap. The trade-off is complexity — tracking "which user just wrote" requires state management via Redis TTL, ThreadLocal, or a separate context store. It is the most accurate strategy, but also the most complex. Defining the boundary of "immediately after a write" can become ambiguous as the number of write-then-read patterns grows.

**Sticky Read**

All reads from a user are routed to Master for a fixed duration after any write.

```java
// pseudo code
if (isWithinStickyWindow(userId, Duration.ofSeconds(2))) {
    return masterDataSource;   // within 2s after write → Master
}
return replicaDataSource;      // otherwise → Replica
```

The advantage is simplicity — no need to distinguish between API endpoints, minimal state tracking, straightforward implementation. The disadvantage is that it over-covers: reads that do not require freshness are also sent to Master during the window, increasing Master traffic and creating potential bottlenecks under high load.

### The Core Difference

| Criterion | Read-after-write | Sticky Read |
|-|-|-|
| Granularity | Per action/data | Per time window |
| Precision | High | Low |
| Master load | Lower | Higher |
| Implementation complexity | Higher | Lower |


## Same Pattern, Different Layer

Across this series, the same principle keeps appearing: consistency strategy should be chosen based on what the data actually requires.

| Part | Layer | Data characteristic | Decision |
|-|-|-|-|
| Part 1 | Redis | Monotonic increase (max) | Lua Script instead of distributed lock |
| Part 2 | Kafka | Ordering requirement differs by topic | Only `chat-message` uses a key |
| Part 3 | Database | Freshness requirement differs by read | R/W Routing now, stronger strategies deferred |

The question was never "How can I guarantee the strongest consistency?" The question was: "What consistency does this data actually require?"


## Conclusion

Replication lag is inevitable once reads and writes are split. The important question is not how to avoid it, but where freshness actually matters. For now, Replica Routing provides the right balance for Minichat.