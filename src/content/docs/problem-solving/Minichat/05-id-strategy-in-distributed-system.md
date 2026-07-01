---
title: 왜 메시지 ID를 직접 만들었을까?
description: "Auto-Increment, UUID 대신 Snowflake ID를 선택한 이유와, 이 결정이 이후 동시성 제어와 순서 보장 전략에 미친 영향을 정리한다."
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


## 배경 — ID는 단순한 식별자가 아니다

Minichat에서 메시지가 생성될 때마다 고유한 ID가 부여된다. 이 ID는 단순히 메시지를 구분하기 위한 값이 아니다.

사용되는 곳을 보면:

- 메시지 조회 시 정렬 기준
- `lastReadMessageId` — 유저가 어디까지 읽었는지 추적
- `lastWrittenMessageId` — 채팅방의 마지막 메시지 판단
- Kafka Consumer에서 이벤트 순서 판단
- DB 조건부 UPDATE의 비교 기준 (`WHERE ... < ?`)

ID가 정렬 기준이자, 최신 상태 판단 기준이자, 동시성 제어 기준이다. ID를 어떻게 생성하느냐에 따라 이후 시스템의 설계 선택지가 달라진다.


## 문제 — 분산 환경에서 ID를 어떻게 생성할 것인가

단일 서버에서 ID를 생성할 때 DB가 순차적으로 번호를 매기면 된다.

하지만 서버가 여러 대로 늘어나면 문제가 달라진다. 각 서버가 동시에 메시지를 생성하고, 각각 독립적으로 ID를 부여해야 한다.

중앙에서 번호를 매기는 방식은 병목이 될 수 있고, 충돌만 방지하는 방식은 메시지 생성 순서 정보를 잃는다.


## 초기 판단 — 익숙한 선택지

초기에는 가장 익숙한 방식부터 검토했다.

ID 생성 책임을 DB에 두는 Auto-Increment는 이미 검증된 방식이다. 순차 증가와 중복 방지를 DB가 보장하고, 구현도 쉽다. 하지만 서버가 여러 대로 늘어나는 환경에서는 질문이 달라진다.

"ID 생성의 중심을 하나의 DB에 계속 둘 수 있는가?"

분산 환경에서는 각 서버가 독립적으로 ID를 생성할 수 있어야 한다. 그렇다면 충돌 없는 ID를 만드는 것만으로 충분할까?


## 데이터 특성 분석 — ID는 어떤 정보를 가져야 하는가

"어떻게 유일한 ID를 만들까"가 아니라 "어떤 의미를 가진 ID를 만들어야 하는가"가 실제 질문이었다.

Minichat의 메시지 ID에 필요한 조건을 정리했다.

**1. 시간 순서 유지가 필요한가?**
`lastReadMessageId`와 `lastWrittenMessageId`는 ID 비교로 최신 상태를 판단한다. ID가 시간 순서를 반영하지 않으면 이 비교가 성립하지 않는다.

**2. 중앙 DB 없이 생성 가능해야 하는가?**
실시간 채팅에서는 여러 서버가 동시에 메시지를 생성한다. 모든 ID 생성을 하나의 DB에 의존하면 생성 경로가 병목이 될 수 있다.

**3. 숫자 비교가 가능해야 하는가?**
`WHERE last_written_message_id < ?` 같은 조건부 UPDATE, Lua Script의 `if ARGV[1] > current` 같은 비교 연산에 직접 사용된다.

정리하면, 필요한 건 "충돌 없는 값"이 아니라 **"분산 환경에서 생성 가능하면서 시간 순서를 유지하고, 최신 상태 판단 기준이 될 수 있는 값"**이었다.


## 트레이드오프 비교

| 기준 | Auto-Increment | UUID | Snowflake |
|-|-|-|-|
| 생성 위치 | DB | 애플리케이션 | 애플리케이션 |
| 시간 순서 | 보장 | 없음 | 시간 기반 증가 |
| 분산 생성 | 어려움 | 가능 | 가능 |
| DB 의존 | 높음 | 없음 | 없음 |
| 숫자 비교 | 가능 | 불가 | 가능 |
| 구현 난이도 | 낮음 | 낮음 | 높음 |

Auto-Increment는 DB 의존성을 가진다. 
UUID는 분산 생성은 쉽지만 순서 정보를 잃는다. 
Snowflake는 구현 복잡성을 감수하는 대신 분산성과 시간 순서를 모두 확보한다.


## 선택 — Snowflake ID

현재 프로젝트에서는 ID가 단순 식별자가 아니라, 데이터 비교와 정합성 판단에 사용되기 때문에 Snowflake가 적합했다. 하지만 모든 시스템에서 Snowflake가 필요한 것은 아니다.

Snowflake ID의 구조:
```
[1비트 부호] [41비트 타임스탬프] [10비트 nodeId] [12비트 시퀀스]
```

타임스탬프가 상위 비트에 위치하므로, 시간이 지나면 값이 자연스럽게 증가한다. 같은 밀리초 안에서는 시퀀스가 증가하고, 다른 서버는 nodeId로 구분된다.

단, 서버 시계가 뒤로 가는 clock drift가 발생하면 단조 증가가 깨질 수 있다. 이 전제가 무너지면 이 ID에 의존하는 모든 비교 연산이 무효화된다.


## 구현

```java
public class Snowflake {
    private static final int NODE_ID_BITS = 10;
    private static final int SEQUENCE_BITS = 12;
    private static final long DEFAULT_CUSTOM_EPOCH = 1735689600000L; // 2025-01-01 00:00:00 UTC

    private final long nodeId;
    private final long customEpoch;
    private volatile long lastTimestamp = -1L;
    private volatile long sequence = 0L;

    public synchronized long nextId() {
        long currentTimestamp = System.currentTimeMillis() - customEpoch;

        // Clock Drift 방어: 시계가 뒤로 가면 따라잡을 때까지 대기
        while (currentTimestamp < lastTimestamp) {
            currentTimestamp = System.currentTimeMillis() - customEpoch;
        }

        if (currentTimestamp == lastTimestamp) {
            sequence = sequence + 1;

            // Sequence 오버플로우 방어 (밀리초당 4096개 초과 시)
            if (sequence > ((1L << SEQUENCE_BITS) - 1)) {
                while (currentTimestamp <= lastTimestamp) {
                    currentTimestamp = System.currentTimeMillis() - customEpoch;
                }
                sequence = 0;
            }
        } else {
            sequence = 0;
        }

        lastTimestamp = currentTimestamp;

        return currentTimestamp << (NODE_ID_BITS + SEQUENCE_BITS)
                | (nodeId << SEQUENCE_BITS)
                | sequence;
    }
}
```

커스텀 Epoch을 2025-01-01로 설정하여 Unix timestamp 기준보다 더 많은 시간을 확보했다.

두 가지 방어 로직이 포함되어 있다. Clock drift 발생 시 이전 timestamp보다 작은 시간이 들어오면 시계가 따라잡을 때까지 대기하여 ID의 단조 증가를 유지한다. 같은 밀리초에 4096개 이상의 ID 생성 요청이 발생하면 다음 밀리초까지 대기하여 sequence overflow를 방지한다.

이 구현에서는 대기 방식으로 clock drift를 처리한다. 실제 운영 환경에서는 NTP 기반 시간 동기화를 기본으로 하고, drift 발생 시 대기할지 예외 처리할지 서비스 요구사항에 따라 정책을 따로 결정해야 한다.


## 검증

### Test 1: 동일 nodeId, 멀티스레드 동시 생성

10개 스레드가 동시에 하나의 Snowflake 인스턴스에서 각 1,000개씩, 총 10,000개의 ID를 생성.

| 항목 | 수치 |
|-|-|
| 총 생성 | 10,000 |
| 고유 ID | 10,000 |
| 중복 | 0 ✅ |

`synchronized`가 같은 밀리초 내에서 시퀀스 충돌을 방지한다.

### Test 2: 다른 nodeId, 동시 생성

nodeId 1과 nodeId 2가 각각 5,000개씩, 총 10,000개를 동시 생성.

| 항목 | 수치 |
|-|-|
| 총 생성 | 10,000 |
| 고유 ID | 10,000 |
| 충돌 | 0 ✅ |

같은 밀리초에 생성되어도 nodeId가 다르면 비트 구성이 달라져 충돌이 발생하지 않는다.

```
Node 1: timestamp=22:43:22.057, nodeId=1, seq=0
Node 2: timestamp=22:43:22.057, nodeId=2, seq=2852

→ 같은 시각이라도 다른 ID
```

### Test 3: 단조 증가 검증

10,000개를 순차 생성하여 모든 ID가 이전보다 큰지 확인.

| 항목 | 결과 |
|-|-|
| 단조 증가 | ✅ 10,000개 전부 이전 ID보다 큼 |

```
ID                     Timestamp                  NodeId  Seq
197708594001481728     2026-06-30 22:43:22.058         1    0
197708594001481729     2026-06-30 22:43:22.058         1    1
197708594001481730     2026-06-30 22:43:22.058         1    2
...
197708594009872141     2026-06-30 22:43:22.060         1  1805
197708594009872142     2026-06-30 22:43:22.060         1  1806
197708594009872143     2026-06-30 22:43:22.060         1  1807
```

같은 밀리초 안에서는 시퀀스가 증가하고, 밀리초가 바뀌면 시퀀스가 리셋된다. ID 크기 비교가 곧 시간 순서 비교가 된다.


## 이 선택이 만든 전제

이번 편에서 다룬 설계 결정들은 모두 Snowflake ID가 제공하는 하나의 전제에 기반한다.

**메시지 ID는 시간이 지나면 증가한다.**

이 특성이 이후 정합성 판단과 순서 처리 방식에 영향을 줬다.

| 편 | 의존하는 전제 | 가능해진 선택 |
|-|-|-|
| 1편 | ID가 단조 증가 → max 비교 가능 | 분산 락 대신 Lua Script |
| 2편 | ID가 단조 증가 → 순서 역전 흡수 가능 | Kafka user-chat-update에서 Key 제거 |
| 3편 | 데이터 특성에 따른 최신성 판단 | Replica Routing |
| 4편 | 영구 밴은 DB에 저장 → Redis 장애 시 fallback 가능 | Fail-Partial 전략 |

1편에서 "Snowflake ID가 단조 증가하니까 max 문제"라고 했고, 2편에서 "조건부 UPDATE가 순서 역전을 흡수한다"고 했다. 이 전제의 출발점이 ID 생성 전략이었다.

UUID를 선택했다면 ID 자체만으로 시간 순서를 판단할 수 없기 때문에, 별도의 정렬 기준이나 버전 관리가 필요했을 것이다. Auto-Increment를 선택했다면 분산 환경에서 DB가 병목이 된다.

초기 ID 설계가 이후 동시성 제어, 순서 보장, 장애 대응 전략의 선택지를 열어준 것이다.


## 마무리

ID 생성은 중복 없는 값을 만드는 문제가 아니었다. Minichat에서는 ID가 정렬 기준이자 정합성 판단 기준이었기 때문에, 분산 환경에서도 시간 순서를 유지하는 Snowflake를 선택했다. 이 결정이 이후 동시성 제어와 순서 보장 전략의 기반이 되었다.