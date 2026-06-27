---
title: Solving a Redis Race Condition Without Distributed Locking
description: "How analyzing the data model led to replacing a distributed lock with a Lua Script for read-status concurrency control."
sidebar:
  order: 1
date: 2026-06-24

tags:
  - Redis
  - Lua Script
  - Distributed Lock
  - Concurrency
  - Minichat
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: June 24, 2026</p>


## Background — Tracking Read Status

In Minichat, each user's read position in a chatroom is tracked by a value called `lastReadMessageId`. This value is used to calculate unread message counts and display read receipts, and it gets updated every time a user opens a chatroom. For fast response times, it is cached in Redis rather than written directly to the database, and periodically synced to the DB through a Write-Back architecture.


## The Problem — A Gap Between GET and SET

The concurrency issue emerged from how `lastReadMessageId` is updated. The process reads the current value (GET), compares it with the new message ID, and writes the new value only if it is larger (SET). Because these are separate Redis commands, another request can slip in between — and the result breaks.

| Time | Request A (message 150) | Request B (message 120) |
|------|--------------------------|--------------------------|
| T1   | GET → current value 100  |                          |
| T2   |                          | GET → current value 100  |
| T3   | 150 > 100 → SET 150     |                          |
| T4   |                          | 120 > 100 → SET 120     |

Request B compares against the snapshot it read at T2 (100), unaware that the value was already updated to 150 at T3. The final value becomes 120, which no longer reflects the user's actual read position.


## Initial Assumption — Distributed Lock

At first, I treated this as a classic race condition.

Two requests could read the same value, compare it independently, and overwrite each other's updates.
Wrapping the `GET → compare → SET` sequence in a distributed lock seemed like the obvious solution.

```java
// Redisson distributed lock approach
public void updateLastReadMessage(Long userId, Long chatId, Long newMessageId) {
    String key = String.format("lastRead:user:%d:chat:%d", userId, chatId);
    String lockKey = "lock:" + key;

    RLock lock = redissonClient.getLock(lockKey);
    try {
        lock.lock();

        String current = redisTemplate.opsForValue().get(key);

        if (current == null || newMessageId > Long.parseLong(current)) {
            redisTemplate.opsForValue().set(key, String.valueOf(newMessageId));
            redisTemplate.opsForSet().add("lastRead:dirty_keys", key);
        }

    } finally {
        lock.unlock();
    }
}
```

*dirty set? : To avoid overloading the DB with high-frequency writes, changed keys are collected in Redis first. A background scheduler periodically reads from this set and batch-syncs them to the database (Write-Back architecture).*

This approach would solve the race condition. But before deciding to synchronize every request, I stopped and asked a different question.

**What exactly is this data?**

Am I protecting an arbitrary state update? 
Or am I protecting something with stronger guarantees?


## Analyzing the Data — When a Lock Isn't Necessary

Minichat generates message IDs using the Snowflake algorithm.
Because the timestamp occupies the most significant bits, IDs increase monotonically over time—even when multiple servers generate them independently.

That changed how I looked at `lastReadMessageId`.

It is not an arbitrary state that moves back and forth.
It only moves forward.

Once I looked at it through that lens, the problem stopped being a synchronization problem.

It became a **max-value maintenance** problem.

The intermediate values no longer mattered.
The only invariant was that the stored value should never decrease.

That means the real requirement was not preventing concurrent access. It was making **compare-and-update** atomic.


## Trade-off — Distributed Lock vs Lua Script

With the problem reframed as a max operation, two options were on the table.

A **distributed lock** guarantees correctness regardless of data characteristics. Any structure wrapped in a critical section is safe. But every request goes through lock acquisition, contention, and release.

A **Lua Script** eliminates lock overhead entirely — but only works because the data is monotonically increasing. If that invariant ever breaks, the entire strategy becomes invalid.

| Criterion | Distributed Lock | Lua Script |
|-|-|-|
| Applicability | Any data pattern | Monotonic data only |
| Execution | Lock acquire/release | Single EVALSHA |
| Correctness guarantee | Ensured by lock | Ensured by data invariant |
| Risk | Deadlock, lock contention | Breaks if ID design changes |

I traded generality for a solution that leveraged the invariant of the data model.


## Implementation — Lua Script

Redis executes Lua Scripts **atomically** on a single thread. By bundling `GET → compare → SET` into one script, atomicity is achieved without any lock.

```lua
-- KEYS[1]: lastRead:user:{userId}:chat:{chatId}
-- KEYS[2]: lastRead:dirty_keys (dirty set for Write-Back)
-- ARGV[1]: new message ID

local current = redis.call('GET', KEYS[1])
if not current or tonumber(ARGV[1]) > tonumber(current) then
    redis.call('SET', KEYS[1], ARGV[1])
    redis.call('SADD', KEYS[2], KEYS[1])
    return 1
end
return 0
```

| Aspect | Redisson Distributed Lock | Lua Script |
|-|-|-|
| Network round trips | 5+ (LOCK+GET+SET+SADD+UNLOCK) | 1 (EVALSHA) |
| Lock contention | Waits if another request holds the lock | None |
| Deadlock risk | Exists (process crash before TTL expires) | None |
| Atomicity mechanism | Mutual exclusion via lock | Serial execution on Redis single thread |

Lua Script is not a free optimization. While a Lua Script is running, Redis cannot process any other commands. During script execution, Redis dedicates its single thread to that script. To keep the script as short as possible, the script contains only O(1) operations — GET, compare, SET, and SADD.


## Benchmark — Validating the Structural Difference

The decision was driven by data analysis, not performance measurement. But I ran a benchmark to confirm the difference in execution characteristics.

**Test Setup**
- Total requests: 10,000
- Concurrent threads: 1 / 10 / 50 / 100
- Lettuce (Spring Data Redis default) + Redisson

### MODE 1: SINGLE_KEY — Extreme Contention
> All requests compete for a single key — worst-case lock contention.

| Method | Threads | Throughput | Avg(ms) | P95(ms) | P99(ms) |
| -- | -- | -- | -- | -- | -- |
| Lua Script | 1–100 | 28k → 210k | 0.03→0.47 | 0.04→0.67 | 0.05→0.83 |
| Redisson Lock | 1–100 | ~6k | 0.17→15.78 | 0.21→108 | 0.35→234 |

### MODE 2: MULTI_KEY — Distributed Load
> Requests spread across multiple keys — closer to production conditions.

| Method | Threads | Throughput | Avg(ms) | P95(ms) | P99(ms) |
| -- | -- | -- | -- | -- | -- |
| Lua Script | 1–100 | 35k → 208k | 0.03→0.47 | 0.04→0.61 | 0.05→0.67 |
| Redisson Lock | 1–100 | 6k → 15k | 0.15→6.62 | 0.17→14 | 0.19→21 |

The gap was most pronounced under single-key contention. Lock-based approaches saw P95/P99 latency spike dramatically as contention increased, while Lua Script scaled roughly linearly with thread count. Under distributed keys, lock performance improved — but the structural overhead from additional round trips remained.


## Same Pattern, Different Layer — Conditional UPDATE

Values updated in Redis are eventually synced to the database through Write-Back. The same race condition can occur at the DB layer, so the same pattern was applied.

```sql
UPDATE user_chat
SET last_read_message_id = ?
WHERE user_id = ?
  AND chat_id = ?
  AND (last_read_message_id IS NULL OR last_read_message_id < ?)
```

The `WHERE last_read_message_id < ?` clause serves the same role as the Lua Script's `if tonumber(ARGV[1]) > tonumber(current)`. Because Snowflake IDs guarantee monotonic increase, the same rule maintains correctness regardless of which layer applies it.

| Layer | Data | Update Strategy |
| -- | -- | -- |
| Redis | `lastReadMessageId` | Lua Script (conditional compare-and-set) |
| DB | `last_read_message_id` | Conditional UPDATE |


## Conclusion

I traded generality for a strategy that depends on the data model's invariant. Because Snowflake IDs guarantee monotonic increase, a lock was never the right tool for this problem. The same compare-and-set rule — "update only if the new value is greater" — carried from Redis through to the database, without synchronization at any layer.