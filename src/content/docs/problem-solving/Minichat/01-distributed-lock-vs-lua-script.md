---
title: 왜 분산 락을 쓰지 않았을까?
description: "읽음 상태 갱신의 Race Condition을 분산 락 대신 Lua Script로 해결한 과정과 비용 구조를 정리한다."
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


## 배경 — 읽음 상태 추적

Minichat에서는 유저가 채팅방의 메시지를 어디까지 읽었는지를 `lastReadMessageId`로 관리한다. 이 값은 안 읽은 메시지 수 계산, 읽음 표시 등에 사용되며, 유저가 채팅방을 열 때마다 갱신된다. 빠른 응답을 위해 DB가 아닌 Redis에 캐싱하고, 주기적으로 DB에 반영하는 Write-Back 구조를 사용한다.


## 문제 — GET과 SET 사이의 경합

읽음 상태(`lastReadMessageId`)를 Redis에 캐싱하는 구조에서 동시성 문제가 발생할 수 있다. 현재 값을 읽고(GET), 새 메시지 ID와 비교한 뒤, 더 큰 경우에만 갱신(SET)하는데, 이 사이에 다른 요청이 끼어들면 결과가 꼬인다.

| 시점  | 요청 A (메시지 150) | 요청 B (메시지 120) |
|------|---------------------|---------------------|
| T1   | GET → 현재값 100      |                     |
| T2   |                     | GET → 현재값 100      |
| T3   | 150 > 100 → SET 150 |                     |
| T4   |                     | 120 > 100 → SET 120 |

요청 B가 T2 시점의 스냅샷(100)을 기준으로 비교하므로, T3의 갱신을 인식하지 못한다. 최종값이 120이 되어 유저의 실제 읽음 상태(150)와 어긋난다.


## 초기 판단 — 분산 락

첫번째로 든 생각은 분산 락이었다. `GET → 비교 → SET`을 임계 구역으로 묶으면 경합은 사라진다.

```java
// Redisson 분산 락 방식
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

*dirty set? : RDB 부하 방지를 위해 고빈도 쓰기를 Redis에서 선처리 후 변경된 키만 수집하는 구조. 이후 백그라운드 스케줄러가 이를 주기적으로 조회하여 DB에 비동기로 일괄 반영하는 Write-Back 아키텍처.*

정합성은 보장되지만, 락 획득/해제 과정에서 추가 Redis 왕복이 발생한다. `lastReadMessageId`는 높은 빈도로 갱신되므로, 요청마다 락을 거는 부하가 부담스러웠다.

그래서 락을 적용하기 전에 갱신 대상인 데이터부터 다시 봤다.


## 데이터 특성 분석 — 락이 필요 없는 조건

Minichat의 메시지 ID는 Snowflake 기반으로 생성된다. 타임스탬프가 상위 비트에 위치하므로, 여러 서버가 독립적으로 ID를 생성해도 시간 순서에 따라 값이 단조 증가한다.

이 특성 때문에 `lastReadMessageId`는 상태 갱신이 아닌 **최댓값 유지(max)** 문제가 된다. 중간값이 누락되어도 결과에 영향이 없고, 순서와 무관하게 `max(current, newValue)`만 유지하면 정합성이 보장된다.

즉, 필요한 건 "한 번에 하나만 실행"이 아니라 "비교와 쓰기를 하나의 명령으로 실행"하게 처리하는 것이다.  


## 트레이드 오프 — 분산 락 vs Lua Script

데이터가 max 문제라는 걸 확인한 뒤, 두 가지 선택지를 놓고 비교했다.

**분산 락**은 데이터 패턴과 무관하게 정합성을 보장한다. 어떤 구조든 임계 구역으로 묶으면 안전하다. 대신 매 요청마다 락 획득/해제의 네트워크 왕복을 지불해야 한다.

**Lua Script**는 단조 증가라는 데이터 특성에 의존하는 대신, 락 비용을 완전히 제거할 수 있다. 단, 이 전제가 깨지면 전략 자체가 무효화된다.

| 기준 | 분산 락 | Lua Script |
|-|-|-|
| 적용 조건 | 데이터 패턴 무관 | 단조 증가 데이터에 한정 |
| 요청당 비용 | 락 획득/해제 왕복 포함 | 1회 EVALSHA |
| 정합성 전제 | 락이 보장 | 데이터 특성이 보장 |
| 리스크 | 데드락, 락 경합 | ID 설계가 바뀌면 무효화 |

범용성을 버리고 데이터 특성에 의존하는 방향을 선택했다.


## 구현 — Lua Script

Redis Lua Script는 단일 스레드에서 **원자적으로 실행**된다. `GET → 비교 → SET`을 하나의 스크립트로 묶으면 락 없이 원자성을 확보할 수 있다.

```lua
-- KEYS[1]: lastRead:user:{userId}:chat:{chatId}
-- KEYS[2]: lastRead:dirty_keys (Write-Back용 Dirty Set)
-- ARGV[1]: 새로운 메시지 ID

local current = redis.call('GET', KEYS[1])
if not current or tonumber(ARGV[1]) > tonumber(current) then
    redis.call('SET', KEYS[1], ARGV[1])
    redis.call('SADD', KEYS[2], KEYS[1])
    return 1
end
return 0
```

| 구분 | Redisson 분산 락 | Lua Script |
|-|-|-|
| 네트워크 왕복 | 5회 이상 (LOCK+GET+SET+SADD+UNLOCK) | 1회 (EVALSHA) |
| 락 대기 | 다른 요청이 락을 잡고 있으면 대기 | 없음 |
| 데드락 리스크 | 존재 (TTL 만료 전 프로세스 종료 시) | 없음 |
| 원자성 보장 | 락에 의한 상호 배제 | Redis 단일 스레드에 의한 직렬 실행 |

단, Lua Script 실행 중에는 Redis가 다른 요청을 처리하지 못한다. 원자성의 대가가 스레드 점유다. 따라서 스크립트는 O(1) 연산(GET, 비교, SET, SADD)만 구성했다.


## 벤치마크 — 구조적 수치 확인

데이터 특성에 기반한 판단이었지만, 구조적 차이를 수치로 확인하기 위해 벤치마크를 수행했다.

**테스트 환경**
- 총 요청 수: 10,000
- 동시 스레드: 1 / 10 / 50 / 100
- Lettuce + Redisson 기반 비교

### MODE 1: SINGLE_KEY (동일 키 경합)
> **시뮬레이션 상황:** 하나의 채팅방에 모든 요청이 몰리는 극단적 경합 상황.

| Method | Threads | Throughput | Avg(ms) | P95(ms) | P99(ms) |
| -- | -- | -- | -- | -- | -- |
| Lua Script | 1–100   | 28k → 210k | 0.03→0.47 | 0.04→0.67 | 0.05→0.83 |
| Redisson Lock | 1–100   | ~6k         | 0.17→15.78 | 0.21→108  | 0.35→234  |

### MODE 2: MULTI_KEY (키 분산)
> **시뮬레이션 상황:** 여러 유저가 각자 다른 채팅방을 열어 분산 갱신하는 일반적 상황.

| Method | Threads | Throughput | Avg(ms) | P95(ms) | P99(ms) |
| -- | -- | -- | -- | -- | -- |
| Lua Script | 1–100   | 35k → 208k | 0.03→0.47 | 0.04→0.61 | 0.05→0.67 |
| Redisson Lock | 1–100 | 6k → 15k | 0.15→6.62 | 0.17→14 | 0.19→21 |

동일 키 경합에서 격차가 가장 크게 나타났다. 락은 경합이 몰릴수록 P95/P99 지연이 급증하는 반면, Lua Script는 비교적 선형적으로 확장됐다. 키 분산 시 락의 성능은 개선되지만, 왕복 횟수에서 오는 구조적 차이는 유지됐다.


## 같은 패턴, 다른 레이어 — 조건부 UPDATE

Redis에서 갱신된 값은 Write-Back 방식으로 DB에 반영된다. DB에서도 동일한 경합 가능성이 있으므로, 같은 패턴을 적용했다.

```sql
UPDATE user_chat
SET last_read_message_id = ?
WHERE user_id = ?
  AND chat_id = ?
  AND (last_read_message_id IS NULL OR last_read_message_id < ?)
```

`WHERE last_read_message_id < ?`가 Lua Script의 `if tonumber(ARGV[1]) > tonumber(current)`와 같은 역할을 한다. Snowflake ID의 단조 증가가 전제되어 있기 때문에, 레이어가 달라져도 동일한 규칙으로 정합성을 유지할 수 있다.

| 레이어 | 데이터 | 갱신 방식 |
| -- | -- | -- |
| Redis | `lastReadMessageId` | Lua Script (조건부 비교 후 SET) |
| DB | `last_read_message_id` | 조건부 UPDATE |


## 마무리

분산 락의 범용성 대신 데이터 특성에 의존하는 전략을 택했고, 그 결과 락 없이 Redis부터 DB까지 동일한 정합성 규칙을 적용할 수 있었다. 