---
title: 읽기/쓰기 분리에서 복제 지연을 어떻게 다뤄야 할까?
description: "읽기/쓰기 분리 후 복제 지연으로 인해 같은 시점에 Master와 Replica가 다른 데이터를 반환하는 문제와 대응 전략을 정리한다."
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


## 배경 — 읽기/쓰기 분리

Minichat은 조회 요청이 쓰기보다 훨씬 많다. 채팅방 목록 조회, 메시지 조회, 유저 정보 조회 등 대부분의 API가 읽기 작업이다.

읽기 부하를 Master에서 분리하기 위해 DataSource Routing을 적용했다. `@Transactional(readOnly = true)`이면 Replica로, 아니면 Master로 라우팅한다. Master 1대, Replica 3대 구성이다.


## 문제 — 복제 지연

Master에 쓴 데이터가 Replica에 복제되기까지는 시간이 걸린다.

유저가 메시지를 보낸 직후 채팅방 목록을 조회하면:
```
메시지 전송 → Master UPDATE (lastWrittenMessageId = 170)
↓
채팅방 목록 조회 → @Transactional(readOnly = true) → Replica
↓
Replica에는 아직 복제 안 됨 → lastWrittenMessageId = 150 반환
↓
최신 메시지가 목록에 보이지 않음
```

쓰기와 읽기가 다른 DB를 바라보기 때문에, **복제 지연**만큼의 시간 동안 데이터가 불일치한다.


## 검증 — 복제 지연 시 읽기 불일치 재현

실제 Master-Replica 환경에서 복제 지연이 발생했을 때 읽기 결과가 달라지는지 확인했다.

**테스트 환경**
- Master: localhost:3301
- Replica: localhost:3307, 3308, 3309
- MySQL Replication (GTID 기반)

**시나리오: Replica SQL_THREAD를 정지시켜 복제 지연을 인위적으로 재현**
1. 초기 상태: Master와 Replica 모두 동일한 데이터
2. Replica의 SQL_THREAD 정지 → 복제 중단
3. Master에 lastWrittenMessageId UPDATE
4. 양쪽 조회 비교
5. SQL_THREAD 재시작 → 복제 재개 후 재조회

### 결과

| 단계 | 조회 대상 | 반환값 | 상태 |
|-|-|-|-|
| Master UPDATE 후 | Master | 170 | 최신 |
| Master UPDATE 후 | Replica | 124000000000010000 | 복제 지연 — 이전 값 유지 |
| SQL_THREAD 재시작 후 | Master | 170 | 최신 |

Master에 `lastWrittenMessageId = 170`으로 갱신한 뒤, 같은 시점에 Replica를 조회하면 갱신 이전의 값이 반환된다. `@Transactional(readOnly = true)`가 Replica로 라우팅되는 환경에서, 복제 지연이 존재하는 동안 유저는 오래된 데이터를 보게 된다.

SQL_THREAD를 재시작하면 Master의 변경 사항이 Replica에 복제되어 양쪽 값이 일치한다. 즉, 불일치는 영구적이 아니라 복제 지연 구간에서만 발생하지만, 그 구간 동안의 사용자 경험은 보장되지 않는다.


## 초기 판단 — 읽기를 전부 Master로 보내면?

가장 단순한 해결책은 읽기도 Master에서 처리하는 것이다. 복제 지연 자체가 사라진다.

하지만 그러면 Replica를 두는 의미가 없어진다. 모든 트래픽이 Master에 몰리고, 읽기 부하 분산이라는 원래 목적이 무효화된다.

그래서 읽기 요청의 성격을 다시 봤다.


## 데이터 특성 분석

모든 읽기가 같은 수준의 최신성을 요구하지는 않는다.

- **즉시 반영이 필요한 데이터:** 방금 보낸 메시지, 채팅방의 마지막 메시지, 읽음 상태. 유저가 직접 수행한 행위의 결과이므로, 지연 없이 반영되어야 사용자 경험이 유지된다.
- **지연을 허용할 수 있는 데이터:** 프로필 정보, 검색 결과, 유저 목록. 복제가 수백 ms 늦더라도 서비스 이용에 체감되는 영향이 적다.

**즉, 읽기 요청마다 필요한 일관성 수준이 다르다.**


## 트레이드오프 비교

복제 지연에 대응하는 전략을 비교했다.

| 방식 | 최신 데이터 보장 | 구현 난이도 | Master 부하 |
|-|-|-|-|
| Master만 조회 | 항상 | 매우 낮음 | 매우 높음 (Replica 무의미) |
| Replica 조회 | 보장 안 됨 | 낮음 | 낮음 |
| Sticky Read | 대부분 | 중간 | 중간 |
| Read-after-write | 보장 | 높음 | 중간 |

**Master만 조회:** 최신성은 보장되지만 읽기 부하 분산이 사라진다.  <br>
**Replica 조회:** 부하 분산은 되지만 복제 지연 시 오래된 데이터를 반환한다. <br>
**Sticky Read:** 쓰기 직후 일정 시간(TTL) 동안만 Master를 조회한다. <br>
**Read-after-write:** 내가 방금 쓴 데이터는 반드시 읽을 수 있도록 보장한다. <br>


## 선택

### 현재 선택 — Replica Routing

현재 Minichat에서는 `@Transactional(readOnly = true)` 기준의 DataSource Routing까지만 적용했다. 쓰기는 Master, 읽기는 Replica로 분기한다.

```java
@Override
protected Object determineCurrentLookupKey() {
    if (TransactionSynchronizationManager.isCurrentTransactionReadOnly()) {
        return masterReplicaKeyRouter.getReplicaKey();
    }
    return masterReplicaKeyRouter.getMasterKey();
}
```

Sticky Read나 Read-after-write는 적용하지 않았다. 현재 프로젝트에서는 복제 지연으로 인한 일시적인 데이터 불일치보다, 읽기 부하를 Master에서 분리하는 이점이 더 크다고 판단했다.


### 추후 고려할 전략 - Read after write VS Sticky Read

그러나 서비스 규모가 커지거나, 쓰기 직후 최신 데이터를 반드시 보여줘야 하는 API가 늘어난다면 읽기 전략도 함께 변경해야 한다.

복제 지연 문제를 해결하기 위한 방법은 단순히 Replica를 버리거나 Master로 고정하는 방식만 있는 것은 아니었다.

설계 단계에서 고려할 수 있는 대표적인 전략은 다음 두 가지였다.

**Read-after-write**

특정 조건에서만 Master DB로 조회를 전환하는 방식이다.

여기서 핵심은 “모든 읽기”가 아니라 “쓰기 직후 발생하는 특정 읽기만” Master로 보내는 것이다.

예를 들어 채팅 시스템에서는 다음과 같이 나뉜다.

- 메시지 전송 직후 채팅방 목록 조회 → Master
- 단순 친구 목록 조회 → Replica 유지

```java
// pseudo code
if (hasRecentWrite(userId)) {
    return masterDataSource;   // 본인의 쓰기 직후 → Master
}
return replicaDataSource;      // 그 외 → Replica
```

이 방식은 Master 부하를 최소화하면서도 사용자 경험이 중요한 구간만 정확하게 보장할 수 있다.

다만, “쓰기 직후”라는 상태를 추적해야 하기 때문에 Redis TTL, ThreadLocal, 또는 별도 컨텍스트 저장이 필요하다.

즉, 가장 정확하지만 가장 복잡한 방식이다.

다만 이 방식은 “어떤 요청이 쓰기 직후인지”를 정의해야 한다는 점에서 경계가 애매해진다.

**Sticky Read**

쓰기 이후 일정 시간 동안 모든 읽기를 Master로 보내는 방식이다.

```java
// pseudo code
if (isWithinStickyWindow(userId, Duration.ofSeconds(2))) {
    return masterDataSource;   // 쓰기 후 2초간 → Master
}
return replicaDataSource;      // 그 외 → Replica
```

예를 들어 메시지 전송 후 2초 동안은 해당 유저의 모든 읽기 요청이 Master로 라우팅된다.

이 방식의 장점은 단순함이다.
- API 구분 필요 없음
- 상태 추적 최소화
- 구현이 비교적 직관적

하지만 그 대신
- Master 트래픽 증가
- 불필요한 읽기까지 Master로 이동
- 트래픽 증가 시 병목 위험

이라는 단점이 존재한다.

결국 시간 기반으로 해결하기 때문에 정확한 문제 구간을 과하게 덮는 구조가 된다.

### 두 방식의 핵심 차이
| 기준        | Read-after-write | Sticky Read |
| --------- | ---------------- | ----------- |
| 기준 단위     | 데이터/행위           | 시간          |
| 정밀도       | 높음               | 낮음          |
| Master 부하 | 낮음               | 상대적으로 높음    |
| 구현 난이도    | 높음               | 낮음          |



## 같은 패턴, 다른 레이어

이번 시리즈에서 공통적으로 적용한 것은 "데이터 특성에 따라 정합성 전략을 다르게 선택한다"는 판단이다.

| 편 | 레이어 | 데이터 특성 | 선택 |
|-|-|-|-|
| 1편 | Redis | 단조 증가 (max) | 분산 락 대신 Lua Script |
| 2편 | Kafka | 순서 필요 여부가 토픽마다 다름 | chat-message만 Key 사용 |
| 3편 | Database | 읽기마다 필요한 최신성이 다름 | R/W Routing 적용, 추가 전략은 보류 |


## 마무리

결국 복제 지연은 제거할 수 있는 문제가 아니라, 어느 수준까지 허용할지의 문제였다.
현재는 Replica Routing만으로 충분하다고 판단했다.