---
title: "Same Redis Failure, Different Failure Strategies"
description: "When Redis goes down, Rate Limiter lets requests through while Ban Check falls back to the database. Here's why two features chose different responses to the same failure."
sidebar:
  order: 4
date: 2026-06-30

tags:
  - Redis
  - Fail-Open
  - Fail-Partial
  - Fault Tolerance
  - Minichat
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: June 30, 2026</p>


## Background — Two Features, One Redis Dependency

Minichat uses Redis across multiple features — read status caching, Write-Back scheduling, rate limiting, and ban state checks. This article focuses on two of those features that required different failure responses when Redis became unavailable.

The first is the **Rate Limiter**. It restricts how many messages a user can send within a time window to prevent abuse. It is implemented as a Sliding Window counter using a Lua Script on a Redis Sorted Set.

The second is the **Ban Check**. It verifies whether a user is banned before allowing access. Temporary bans are stored in Redis with a TTL. Permanent bans are stored in the database.

Both features depend on Redis. But when Redis fails, what they lose is not the same thing.


## The Problem — What Happens When Redis Goes Down

A Redis failure affects both features simultaneously. But the consequences are different.

**If Rate Limiter stops working:**
Request frequency can no longer be evaluated. Abusive users may send messages without any throttling.

**If Ban Check stops working:**
Ban status can no longer be verified. A banned user may re-enter the service and directly affect other users.

The same outage. But the damage structure is different.


## Initial Assumption — Block Everything When in Doubt

The most conservative approach is to block all requests when Redis is unavailable. If the system cannot verify state, it should deny access. From a security standpoint, Fail-Closed seems like the safest default.

However, before applying the same strategy to every feature, I looked at what Fail-Closed would actually mean for each one.

For Ban Check, Fail-Closed makes sense — if we cannot verify whether a user is banned, blocking access is a reasonable precaution.

For Rate Limiter, the picture changes. If Redis goes down for even a few seconds and Rate Limiter applies Fail-Closed, every normal user's message transmission is blocked. The system would sacrifice all legitimate users to prevent a handful of abusers from temporarily bypassing limits.

That trade-off did not seem right. So I analyzed the failure impact of each feature separately.


## Failure Impact Analysis — What Is Each Feature Protecting?

Before choosing a failure strategy, I compared who gets hurt when each feature fails.

**Rate Limiter failure:**
Abusive users can temporarily bypass rate limits. The impact is increased system load — not direct harm to individual users. But if Fail-Closed is applied instead, the entire user base loses the ability to send messages. The cure becomes worse than the disease.

**Ban Check failure:**
A banned user can access the service. The impact is direct — other users are exposed to someone who was explicitly removed. Service trust is undermined.

| Feature | Who gets hurt on failure | Fail-Open risk | Fail-Closed risk |
|-|-|-|-|
| Rate Limiter | System (load increase) | Some abusers bypass limits | All normal users blocked |
| Ban Check | Other users (direct harm) | Banned user accesses service | Access denied (safe) |

For Rate Limiter, the cost of Fail-Open (temporary bypass) is smaller than the cost of Fail-Closed (total service disruption). For Ban Check, the relationship is reversed.

The important question was not whether Redis failed. It was what failure meant for each feature.


## Trade-off Comparison

| Strategy | Behavior on failure | Advantage | Disadvantage | Best fit |
|-|-|-|-|-|
| Fail-Open | Allow request | Service stays available | Controls may be bypassed | Availability-critical features |
| Fail-Closed | Block request | Security maintained | May cause total outage | Security-critical features |
| Fail-Partial | Use alternative path | Maintains both function and protection | Higher implementation complexity | When a fallback data source exists |


## The Decision

**Rate Limiter → Fail-Open.** When Redis is unavailable, requests pass through. Temporary bypass by a few abusers is a smaller cost than blocking the entire service.

**Ban Check → Fail-Partial.** When Redis is unavailable, the system falls back to the database to check permanent ban status. A banned user accessing the service causes direct harm to others, so the system cannot simply let everyone through.

The decision was not based on Redis. It was based on what each feature was responsible for protecting.


## Implementation

### Rate Limiter — Fail-Open

```java
// RateLimitAspect.java
try {
    Long result = redisTemplateForString.execute(
            rateLimitScript,
            Collections.singletonList(redisKey),
            String.valueOf(currentTime),
            String.valueOf(WINDOW_SIZE_MS),
            String.valueOf(MESSAGE_LIMIT),
            uniqueMember
    );

    if (result != null && result == 1) {
        userBanService.applyStrike(userId);
        session.close(CloseStatus.POLICY_VIOLATION);
        return null;
    }

} catch (Exception e) {
    // Redis failure: allow the request rather than blocking (Fail-Open)
    log.error("[RateLimit] Redis script error. user: {}", userId, e);
}

return joinPoint.proceed();
```

The `catch (Exception e)` block is not just error handling. It defines the failure policy. When Redis is unavailable, the exception is caught and the original method (`joinPoint.proceed()`) executes normally. The request is never blocked due to a Redis outage.

### Ban Check — Fail-Partial (DB Fallback)

```java
// UserBanService.java
public boolean isUserBanned(Long userId) {
    String tempBanKey = TEMP_BAN_KEY_PREFIX + userId;

    try {
        // 1. Check temporary ban (Redis)
        if (redisTemplateForString.hasKey(tempBanKey)) {
            return true;
        }
    } catch (Exception e) {
        // Redis failure: fall through to DB check
        log.error("Redis error during ban check", e);
    }

    // 2. Check permanent ban (DB)
    return userRepository.findById(userId)
            .map(user -> user.getUserStatus() == UserStatus.BAN)
            .orElse(false);
}
```

When Redis fails, the catch block absorbs the exception and the method falls through to the database query. The system does not open completely — it switches to a slower but durable data source. Not fully open, not fully closed.

### 3-Strike System — Temporary State in Redis, Permanent State in DB

```java
// UserBanService.java
public void applyStrike(Long userId) {
    // Strike 1 → Redis TTL 1 day
    // Strike 2 → Redis TTL 7 days
    // Strike 3 → DB permanent ban + Redis keys deleted
}
```

Temporary bans live in Redis and expire automatically via TTL. Permanent bans are written to the database. When Strike 3 is reached, the state transitions from Redis to DB and Redis keys are cleaned up. Because temporary and permanent states are stored separately, the DB fallback in Ban Check can always verify permanent bans — even when Redis is completely unavailable.


## Validation — One Redis Failure, Two Different Behaviors

To confirm that the two features respond differently to the same Redis failure, I stopped Redis and observed the behavior.

**Test Setup**
- Redis: localhost:6379 (Docker)
- MySQL: localhost:3301
- Spring Boot 3.3.1

### Scenario 1: Redis Normal

| Feature | Behavior | Result |
|-|-|-|
| Rate Limiter | Lua Script executes | ✅ Request allowed |
| Ban Check (not banned) | Redis lookup → key not found | ✅ Access granted |
| Ban Check (temp banned) | Redis lookup → key found | ⛔ Blocked |

### Scenario 2: Redis Down (`docker stop redis-1`)

| Feature | Behavior after Redis failure | Result |
|-|-|-|
| Rate Limiter | catch(Exception) → request passes | ✅ Fail-Open |
| Ban Check (BAN user) | Redis fails → DB fallback → BAN confirmed | ⛔ Still blocked |
| Ban Check (ACTIVE user) | Redis fails → DB fallback → ACTIVE confirmed | ✅ Access granted |

The same Redis failure produced two different outcomes. Rate Limiter allowed the request through. Ban Check maintained its protection via database fallback.

### Scenario 3: 3-Strike Escalation

| Strike | Storage | State | Result |
|-|-|-|-|
| 1 | Redis | STRIKE_1, TTL 23 hours | 1-day ban |
| 2 | Redis | STRIKE_2, TTL 168 hours | 7-day ban |
| 3 | DB | user_status=BAN, Redis keys deleted | Permanent ban |

Temporary bans auto-expire through Redis TTL. On the third strike, the state moves to the database permanently. Because the storage is split between Redis (temporary) and DB (permanent), the Ban Check's DB fallback can always enforce permanent bans regardless of Redis availability.


## Same Pattern, Different Layer

The recurring principle across this series is: do not apply the strongest guarantee everywhere.

| Part | Layer | Problem | Decision |
|-|-|-|-|
| Part 1 | Redis | Race Condition | Data invariant made distributed lock unnecessary |
| Part 2 | Kafka | Ordering reversal | Only the topic that needed ordering used a key |
| Part 3 | Database | Replication lag | Routing strategy chosen per read's freshness requirement |
| Part 4 | Redis failure | Damage differs by feature | Failure strategy chosen by protection target |

## Conclusion

There is no universal failure strategy.

Rate Limiter chose Fail-Open because availability was the priority.
Ban Check chose DB fallback because user protection was the priority.

The right failure response depends on what the system is protecting.