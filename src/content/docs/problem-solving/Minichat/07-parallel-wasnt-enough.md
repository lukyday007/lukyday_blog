---
title: 병렬 처리했는데 왜 계속 느렸을까?
description: "parallelStream으로 메시지 전달을 병렬화했지만 병목은 해소되지 않았다. 호출 대상을 유저에서 서버로 바꾸고, 벌크 처리 후 병렬화를 적용한 과정과 벤치마크 결과를 정리한다."
sidebar:
  order: 7
date: 2026-07-06 

tags:
  - gRPC
  - Redis
  - Bulk
  - Optimization
  - Minichat
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: July 06, 2026</p>


## 배경 — 한 메시지, 수백 명의 수신자

6편에서 WebSocket 서버가 여러 대로 늘어나면서 Target Routing을 선택했다. Redis에 유저별 연결 서버 정보를 저장하고, 로컬 세션이 있으면 WebSocket으로 직접 전달, 없으면 gRPC로 해당 서버에 릴레이하는 구조다.

채팅방 하나에 메시지가 발생하면, 그 메시지는 채팅방에 속한 모든 유저에게 전달되어야 한다. 유저 수가 수십~수백 명이면, 메시지 하나당 전달 작업도 수십~수백 번 발생한다.


## 문제 — 유저 수만큼 늘어나는 네트워크 호출

6편에서 구현한 코드는 다음과 같다.

```java
for (Long userId : userIdsInChat) {
    WebSocketSession receiverSession = sessionManager.getSession(userId);

    if (receiverSession != null && receiverSession.isOpen()) {
        receiverSession.sendMessage(textMessage);
    } else {
        String targetServerId = redisTemplateForString.opsForValue()
                .get(USER_SERVER_KEY_PREFIX + userId);

        if (targetServerId != null && !targetServerId.equals(serverIdentifier)) {
            relayMessageViaGrpc(targetServerId, message, userId);
        }
    }
}
```

메시지가 발생하면 채팅방에 속한 모든 유저에게 전달되어야 한다. 로컬에 연결된 유저는 WebSocket으로 바로 전달하면 된다.

문제는 원격 서버에 연결된 유저다. 수신자의 연결 서버를 Redis에서 조회한 뒤, 해당 서버로 gRPC 릴레이를 수행해야 한다.

즉, 원격 유저가 많아질수록 Redis 조회와 gRPC 릴레이 작업도 함께 늘어난다.


## 초기 판단 — 호출이 느리면 병렬로

당시에는 병목이 네트워크 호출 자체라고 생각했다.

Redis 조회와 gRPC 릴레이는 유저마다 서로 독립적으로 수행된다. 따라서 호출 횟수는 많지만, 동시에 실행할 수 있는 작업이라고 판단했다.

그래서 `parallelStream()`을 적용해 유저별 전달을 병렬화했다. 200번의 호출을 순차적으로 실행하는 대신 동시에 실행하면 전체 latency도 크게 줄어들 것이라고 생각했기 때문이다.


## 벤치마크 — 기대 이하의 개선폭

병렬 처리 후 성능을 측정했다. 

| 항목 | Avg | P95 | P99 |
|-|-|-|-|
| Redis GET × 200 | 12.5ms | 14.6ms | 18.9ms |
| gRPC relay × 200 | 23.9ms | 41.1ms | 54.6ms |
| **Total** | **36.4ms** | **55.7ms** | **70.4ms** |

메시지 하나를 전달하는 데 평균 36ms, P99에서는 70ms에 달한다.

병렬화 덕분에 순차 처리보다는 빨라졌지만, 기대한 수준의 개선은 아니었다. 무엇보다 Redis와 gRPC 구간이 대부분의 시간을 차지하고 있었다.

병렬 처리를 적용했는데도 이 정도라면, 뭔가 근본적인 부분을 놓치고 있는 것 아닌가?


## 호출 대상 분석 — 잘못된 질문

병렬화는 분명 적용했다. 그런데 왜 여전히 Redis 조회와 gRPC 호출이 대부분의 시간을 차지할까?

실행 방식이 아니라 실행 횟수 자체가 문제인 건 아닐까?

```
User 1  → local2
User 2  → local2
User 3  → local2
...
User 70 → local2
User 71 → local3
...
```

local2에 연결된 유저가 70명이면, 같은 서버에 gRPC를 70번 보내고 있었다. 메시지 내용은 동일하다. 다른 것은 수신자 ID뿐이다.

70번의 호출이 모두 같은 목적지로 향한다면, local2에 1번 보내면서 수신자 70명의 ID를 함께 전달하면 된다.

6편에서 Target Routing의 핵심은 "메시지의 목적지는 특정 서버"라는 것이었다. 그런데 전달 코드에서는 여전히 유저 단위로 호출하고 있었다. 목적지가 서버라는 것을 알면서도, 릴레이는 유저 단위로 하고 있었던 것이다.


## 트레이드오프 비교 — 실행 속도를 높일 것인가, 작업량을 줄일 것인가

| 기준 | 병렬 처리 (Parallel) | 벌크 처리 (Bulk) |
|-|-|-|
| 해결하려는 질문 | 어떻게 더 빠르게 실행할 것인가 | 왜 이렇게 많이 실행하고 있는가 |
| 최적화 대상 | 실행 시간 | 네트워크 호출 횟수 |
| Redis | GET × N (병렬 실행) | MGET × 1 |
| gRPC | relay × N (병렬 실행) | bulkRelay × K (서버 수) |
| 구현 난이도 | 낮음 | 높음 (proto 변경, 그룹핑 로직) |

병렬 처리는 실행을 최적화한다. 벌크 처리는 작업량 자체를 최적화한다.


## 선택 — 먼저 벌크, 그 다음 병렬

벌크와 병렬은 양자택일이 아니다. 순서의 문제다.

호출 횟수가 200번인 상태에서 병렬화하면, 200번을 빠르게 처리할 뿐이다. 호출 횟수를 먼저 서버 수만큼(3번)으로 줄인 후 병렬화하면, 3번을 동시에 처리한다. 같은 병렬화지만 효과가 다르다.

잘못된 작업량을 빠르게 실행하는 것이 아니라, 작업량을 먼저 줄인 뒤 병렬화를 적용하는 순서를 선택했다.


## 구현

### proto 변경 — 벌크 릴레이 RPC 추가

기존 `relayMessage`는 수신자 1명의 ID만 포함한다. 서버 단위로 묶어 보내려면 수신자 목록을 전달할 수 있는 RPC가 필요하다.

```protobuf
// Before
rpc relayMessage(RelayMessageRequest)
    returns (RelayMessageResponse);

// After
rpc relayBulkMessage(RelayBulkMessageRequest)
    returns (RelayMessageResponse);

message RelayBulkMessageRequest {
    repeated int64 recipientIds = 1;
    // senderId, chatId, content ...
}
```

기존에는 수신자 한 명을 전달하는 RPC를 사용했다. 서버 단위로 묶어 전달하기 위해 여러 수신자를 포함할 수 있는 `RelayBulkMessageRequest`와 `relayBulkMessage` RPC로 변경했다.

### sendMessageToChatRoom 변경 — 서버 단위 벌크 릴레이

유저별 루프를 분류 → 벌크 → 릴레이 구조로 변경했다.

```java
// Before
for (Long userId : userIdsInChat) {
    String targetServer = redis.get(userId);
    relayMessage(targetServer, userId, message);
}
```
```java
// After

// 1. 서버 위치를 한 번에 조회
Map<Long, String> userToServer = redis.multiGet(userIds);

// 2. 서버별로 그룹핑
Map<String, List<Long>> recipientsByServer =
        groupByServer(userToServer);

// 3. 서버마다 한 번만 릴레이
recipientsByServer.forEach((serverId, recipients) ->
        grpc.bulkRelay(serverId, recipients, message));
```

기존에는 유저를 순회하며 전달했다.

새로운 구조에서는 먼저 서버를 찾고, 같은 서버의 유저를 하나의 요청으로 묶는다.

처리 단위가 User에서 Server로 바뀌면서 호출 횟수가 유저 수가 아니라 서버 수에 비례하게 되었다.


## 검증

벤치마크 환경은 다음과 같다.
- Redis: localhost, 단일 노드
- gRPC 수신 서버: 테스트 내부에서 기동 (실제 WebSocket 전송 없이 수신 카운트만 기록)
- 측정 대상: `sendMessageToChatRoom`의 핵심 네트워크 구간 (Redis 조회 + gRPC 릴레이)
- 반복: 100회 (Warmup 10회 제외)

### 시나리오 1 — 개별 처리 vs 벌크 처리

원격 유저 200명이 모두 같은 서버에 연결된 상황. 개별 호출과 벌크 호출의 차이를 측정했다.

**개별 처리 (parallelStream + 유저별 호출)**

| 항목 | Avg | P95 | P99 |
|-|-|-|-|
| Redis GET × 200 | 12.5ms | 14.6ms | 18.9ms |
| gRPC relay × 200 | 23.9ms | 41.1ms | 54.6ms |
| **Total** | **36.4ms** | **55.7ms** | **70.4ms** |

**벌크 처리 (서버별 그룹핑 + 벌크 호출)**

| 항목 | Avg | P95 | P99 |
|-|-|-|-|
| Redis MGET × 1 | 0.36ms | 0.53ms | 0.77ms |
| gRPC Bulk × 1 | 0.83ms | 1.23ms | 1.78ms |
| **Total** | **1.2ms** | **1.8ms** | **2.5ms** |

평균 기준 약 30배 차이. Redis 조회가 12.5ms에서 0.36ms로 (약 35배), gRPC 릴레이가 23.9ms에서 0.83ms로 (약 29배) 감소했다. 호출 횟수를 200에서 1로 줄인 결과가 그대로 latency에 반영됐다.

같은 200명에게 메시지를 전달하는데, 실행 방식만 바꿔도(병렬화) 36ms, 작업량을 줄이면(벌크) 1.2ms.

### 시나리오 2 — 벌크 이후 병렬화는 언제 의미를 갖는가

시나리오 1에서 원격 서버가 1대일 때, 벌크 처리에 스레드 풀을 추가해도 효과가 없었다. gRPC 호출이 1번뿐이니 병렬화할 대상이 없기 때문이다.

원격 서버를 3대로 늘리고, 유저 수와 스레드 풀 크기를 변화시키며 측정했다.

**원격 유저 200명, 서버 3대**

| 스레드 풀 | gRPC Avg | Total Avg |
|-|-|-|
| 1 (순차) | 1.50ms | 1.84ms |
| 2 | 1.07ms | 1.49ms |
| 3 | 0.85ms | 1.22ms |
| 4 | 0.87ms | 1.30ms |

**원격 유저 500명, 서버 3대**

| 스레드 풀 | gRPC Avg | Total Avg |
|-|-|-|
| 1 (순차) | 1.46ms | 1.98ms |
| 2 | 1.06ms | 1.59ms |
| 3 | 0.80ms | 1.35ms |
| 4 | 0.81ms | 1.37ms |

**원격 유저 1000명, 서버 3대**

| 스레드 풀 | gRPC Avg | Total Avg |
|-|-|-|
| 1 (순차) | 1.49ms | 2.26ms |
| 2 | 1.09ms | 1.78ms |
| 3 | 0.83ms | 1.57ms |
| 4 | 0.82ms | 1.60ms |

세 가지가 확인된다.

첫째, 스레드 풀 크기가 서버 수(3대)와 일치할 때 가장 빠르다. 3개의 gRPC 호출을 3개의 스레드가 동시에 처리하므로, 가장 느린 호출 하나의 시간만 소요된다. 그 이상 늘려도 병렬화할 대상이 없어 개선되지 않는다.

둘째, 유저 수가 늘어도 Total 증가폭이 작다. 200명일 때 1.22ms, 1000명일 때 1.57ms. 유저 수가 5배 늘었지만 latency는 29% 증가에 그쳤다. 호출 횟수가 유저 수가 아니라 서버 수에 비례하기 때문이다.

셋째, 순차(스레드 풀 1) 대비 병렬(스레드 풀 3)의 개선폭은 유저 수에 따라 커진다. 200명일 때 1.84ms → 1.22ms (34%), 1000명일 때 2.26ms → 1.57ms (31%). 각 gRPC 호출의 payload가 커지면서 병렬 처리의 이득이 뚜렷해진다.


## 같은 패턴, 다른 레이어

| 편 | 문제 | 특성 | 선택 |
|-|-|-|-|
| 1편 | Race Condition | 단조 증가 (max) | 분산 락 대신 Lua Script |
| 2편 | Kafka 순서 역전 | 토픽별 순서 요구 차이 | chat-message만 Key 사용 |
| 3편 | 복제 지연 | 읽기별 최신성 요구 차이 | R/W Routing |
| 4편 | Redis 장애 | 기능별 피해 대상 차이 | Fail 전략 분리 |
| 5편 | ID 생성 | 정렬/비교 기준으로 사용 | Snowflake |
| 6편 | WebSocket Scale-Out | 목적지가 명확한 데이터 | Broadcast 대신 Target Routing |
| 7편 | 메시지 릴레이 최적화 | 호출 대상이 유저가 아니라 서버 | 개별 처리 대신 서버별 벌크 |

6편과 7편은 같은 질문의 연장선에 있다. 6편은 "메시지를 어느 서버로 보낼 것인가"를 결정했고, 7편은 "같은 서버로 가는 메시지를 왜 따로 보내는가"를 해결했다. 목적지를 파악하는 것과 목적지별로 묶어서 보내는 것은 다른 단계의 최적화다.


## 마무리

처음에는 병렬 처리가 병목을 해결할 것이라 생각했다. 하지만 병목은 CPU가 아니라 네트워크 호출 횟수였다. 잘못된 작업량을 빠르게 실행하고 있었을 뿐, 작업량 자체를 줄이지 않았다. 

병렬화는 잘못된 선택이 아니었다. 다만 줄여야 할 것은 실행 시간이 아니라 실행 횟수였다. 작업량을 줄인 뒤에야 병렬화는 비로소 제 역할을 하기 시작했다.