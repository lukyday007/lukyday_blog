---
title: 같은 Redis 장애, 왜 다른 대응을 선택했을까?
description: "Redis 장애 시 Rate Limiter는 요청을 통과시키고, Ban Check는 DB로 폴백한 이유를 정리한다."
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


## 배경 — Redis에 의존하는 두 가지 기능

Minichat에서 Redis는 읽음 상태 캐싱, Write-Back, Rate Limiter, 밴 상태 확인 등 여러 기능에 걸쳐 사용된다. 이 글에서는 그중 Redis 장애 시 서로 다른 대응이 필요했던 두 가지 기능을 다룬다.

- **Rate Limiter:** 유저가 일정 시간 내에 보낼 수 있는 메시지 수를 제한하여 어뷰징을 방지한다. Sliding Window 방식의 Lua Script로 구현되어 있다.
- **Ban Check:** 유저의 차단 상태를 확인하여 밴된 유저의 접속을 막는다. 임시 밴은 Redis에 TTL로 저장하고, 영구 밴은 DB에 저장한다.

**두 기능 모두 Redis에 의존하지만, Redis가 죽었을 때 보호해야 하는 대상이 다르다.**


## 문제 — Redis가 죽으면 어떻게 해야 하는가

Redis 장애가 발생하면 두 기능이 동시에 영향을 받는다.

**Rate Limiter가 동작하지 않으면:**
요청 빈도를 판단할 수 없다. 어뷰저가 제한 없이 메시지를 보낼 수 있다.

**Ban Check가 동작하지 않으면:**
차단 상태를 확인할 수 없다. 밴된 유저가 접속할 수 있고, 다른 유저에게 직접적인 피해가 발생한다.

같은 Redis 장애인데, 실패했을 때의 피해 구조가 다르다.


## 초기 판단 — 전부 차단하면 안전할까

가장 보수적인 방법은 Redis 장애 시 모든 요청을 차단하는 것이다. 보안 관점에서는 판단할 수 없을 때 차단하는 Fail-Closed가 가장 안전한 선택처럼 보인다. 

하지만 Rate Limiter에 Fail-Closed를 적용하면, Redis가 잠깐 죽은 것만으로 정상 유저 전체의 메시지 전송이 차단된다. 어뷰저 몇 명을 막기 위해 정상 유저 전체를 희생시키는 구조가 된다.

그래서 기능별로 장애 시 피해 구조를 다시 봤다.


## 장애 영향 분석 — 누구를 보호해야 하는가

장애 전략을 결정하기 전에, 각 기능이 실패했을 때 누가 피해를 보는지를 비교했다.

**Rate Limiter 실패 시:**
어뷰저가 일시적으로 제한을 우회할 수 있다. 이는 시스템 부하 증가로 이어질 수 있지만, 정상 사용자의 요청 자체를 차단하는 것보다 피해 범위를 통제할 수 있다. 반면 Fail-Closed를 적용하면 정상 유저 전체가 서비스를 이용할 수 없다.

**Ban Check 실패 시:**
밴된 유저가 접속할 수 있다. 이 경우 피해가 다른 유저에게 직접 전달된다. 차단된 유저가 다시 채팅에 참여하면 서비스 신뢰가 무너진다.

정리하면:

| 기능 | 실패 시 피해 대상 | Fail-Open 시 리스크 | Fail-Closed 시 리스크 |
|-|-|-|-|
| Rate Limiter | 시스템 (부하 증가) | 일부 어뷰저 우회 | 정상 유저 전체 차단 |
| Ban Check | 다른 유저 (직접 피해) | 밴 유저 접속 | 접속 차단 (안전) |

Rate Limiter는 Fail-Open의 리스크(일부 우회)가 Fail-Closed의 리스크(전체 차단)보다 작다. Ban Check는 반대다.


## 트레이드오프 비교

장애 대응 전략을 비교했다.

| 전략 | 동작 | 장점 | 단점 | 적합한 상황 |
|-|-|-|-|-|
| Fail-Open | 장애 시 요청 통과 | 서비스 유지 | 제한 우회 가능 | 가용성이 우선인 기능 |
| Fail-Closed | 장애 시 요청 차단 | 보안 유지 | 전체 장애 가능 | 보안이 필수인 기능 |
| Fail-Partial | 장애 시 대체 경로로 판단 | 기능 유지 + 보호 | 구현 복잡 | 대체 데이터소스가 있을 때 |


## 선택

**Rate Limiter → Fail-Open.** Redis 장애 시 요청을 통과시킨다. 정상 유저 전체의 서비스 중단보다 일부 어뷰저의 일시적 우회가 낫다. 
<br>

**Ban Check → Fail-Partial.** Redis 장애 시 DB로 폴백하여 영구 밴 상태를 확인한다. 밴된 유저의 접속은 다른 유저에게 직접 피해를 주므로, 완전히 열어두지 않는다.


## 구현

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
    // Redis 장애 시 요청을 막기보다 통과시킨다 (Fail-Open)
    log.error("[RateLimit] Redis 스크립트 실행 오류. user: {}", userId, e);
}

return joinPoint.proceed();
```

`catch (Exception e)` 블록이 핵심이다. Redis 장애 시 예외를 잡고, 원본 메서드(`joinPoint.proceed()`)를 그대로 실행한다. 요청이 차단되지 않는다.

### Ban Check — Fail-Partial (DB Fallback)

```java
// UserBanService.java
public boolean isUserBanned(Long userId) {
    String tempBanKey = TEMP_BAN_KEY_PREFIX + userId;

    try {
        // 1. 임시 밴(Redis) 확인
        if (redisTemplateForString.hasKey(tempBanKey)) {
            return true;
        }
    } catch (Exception e) {
        // Redis 장애 시 DB만 확인
        log.error("Redis 오류 발생", e);
    }

    // 2. 영구 밴(DB) 확인
    return userRepository.findById(userId)
            .map(user -> user.getUserStatus() == UserStatus.BAN)
            .orElse(false);
}
```

Redis가 실패하면 catch 블록으로 넘어가고, DB에서 영구 밴 여부를 확인한다. 완전히 열리지도, 완전히 닫히지도 않는다.

### 3-Strike — 임시 상태는 Redis, 영구 상태는 DB

```java
// UserBanService.java
public void applyStrike(Long userId) {
    // Strike 1
    // Redis TTL 1일

    // Strike 2
    // Redis TTL 7일

    // Strike 3
    // DB 영구 저장
}
```

임시 밴은 Redis TTL로 자동 만료되고, 영구 밴은 DB에 기록된다. Strike 3에서 DB로 전환되면서 Redis 키는 삭제된다. 임시 상태와 영구 상태의 저장소가 분리되어 있다.


## 검증 — Redis 장애 시 Fail 전략 동작 확인

Redis를 실제로 중지시켜서 두 기능의 장애 대응이 다르게 동작하는지 확인했다.

**테스트 환경**
- Redis: localhost:6379 (Docker)
- MySQL: localhost:3301
- Spring Boot 3.3.1

### Scenario 1: Redis 정상

| 기능 | 동작 | 결과 |
|-|-|-|
| Rate Limiter | Lua Script 실행 | ✅ 요청 허용 |
| Ban Check (밴 없음) | Redis 조회 → 키 없음 | ✅ 접속 허용 |
| Ban Check (임시 밴) | Redis 조회 → 키 있음 | ⛔ 차단 |

### Scenario 2: Redis 장애 (`docker stop redis-1`)

| 기능 | Redis 실패 후 동작 | 결과 |
|-|-|-|
| Rate Limiter | catch(Exception) → 요청 통과 | ✅ Fail-Open |
| Ban Check (BAN 유저) | Redis 실패 → DB fallback → BAN 확인 | ⛔ 차단 유지 |
| Ban Check (ACTIVE 유저) | Redis 실패 → DB fallback → ACTIVE 확인 | ✅ 정상 허용 |

같은 Redis 장애에서 Rate Limiter는 요청을 통과시키고, Ban Check는 DB로 폴백하여 차단을 유지한다. 장애 전략이 기능별로 다르게 동작하는 것을 확인했다.

### Scenario 3: 3-Strike 누적

| Strike | 저장 위치 | 상태 | 결과 |
|-|-|-|-|
| 1 | Redis | STRIKE_1, TTL 23시간 | 1일 밴 |
| 2 | Redis | STRIKE_2, TTL 168시간 | 7일 밴 |
| 3 | DB | user_status=BAN, Redis 키 삭제 | 영구 밴 |

임시 밴은 Redis TTL로 자동 해제되고, 3회 누적 시 DB에 영구 기록된다. 임시 상태는 Redis TTL로 관리하고 영구 상태는 DB에 저장하기 때문에, Redis 장애 상황에서도 영구 밴 정책은 유지된다.


## 같은 패턴, 다른 레이어

이번 시리즈에서 반복되는 판단은 "모든 상황에 가장 강한 보장을 적용하지 않는다"는 것이다.

| 편 | 레이어 | 문제 | 선택 |
|-|-|-|-|
| 1편 | Redis | Race Condition | 데이터 특성 기반으로 분산 락 대신 Lua Script |
| 2편 | Kafka | 순서 역전 | 토픽별 요구사항에 따라 Key 사용 여부 분리 |
| 3편 | Database | 복제 지연 | 읽기별 최신성 요구 수준에 따라 라우팅 |
| 4편 | Redis 장애 | 기능 중단 | 피해 대상에 따라 Fail 전략 분리 |


## 마무리

장애 대응에 하나의 정답은 없다. Rate Limiter는 가용성을 위해 Fail-Open을, Ban Check는 사용자 보호를 위해 DB fallback을 선택했다. 같은 장애라도 보호해야 하는 대상이 다르면 전략도 달라진다.