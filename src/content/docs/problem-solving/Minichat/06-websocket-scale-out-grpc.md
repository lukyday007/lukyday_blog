---
title: WebSocket 메시지를 왜 브로드캐스트하지 않게 됐을까?
description: "WebSocket 서버가 여러 대로 늘어나면서 Pub/Sub 대신 Target Routing을 선택한 과정과, 그 결과 gRPC가 도입된 이유를 정리한다."
sidebar:
  order: 6
date: 2026-07-02

tags:
  - WebSocket
  - gRPC
  - Scale-Out
  - Target Routing
  - Minichat
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: July 02, 2026</p>


## 배경 — WebSocket 연결은 서버 메모리에 존재한다

Minichat은 실시간 메시지 전달을 위해 WebSocket을 사용한다. 유저가 채팅방에 접속하면 서버와 지속 연결이 맺어지고, 메시지가 발생하면 해당 연결을 통해 즉시 전달한다.

이 연결 정보는 서버 인스턴스의 메모리에 저장된다. 단일 서버에서는 모든 세션이 한 곳에 있으니 대상을 찾아 바로 전달하면 된다.


## 문제 — 서버를 늘리면 세션 위치를 모른다

서버가 여러 대로 늘어나면 상황이 달라진다. User A가 server-1에, User B가 server-2에 연결되어 있을 때, User A가 메시지를 보내면 server-1이 수신한다. 하지만 User B의 세션은 server-2에 있다.

메시지를 받을 서버를 어떻게 찾고, 어떻게 전달할 것인가?


## 초기 판단 — 모든 서버에 전달하면 되지 않을까

가장 먼저 떠오른 방법은 Pub/Sub이다. 메시지를 모든 서버에 전달하고, 각 서버가 자신의 세션을 확인해서 대상이 없으면 버리는 방식이다.

하지만 서버가 늘어날수록 문제가 커진다. 목적지는 서버 하나인데, 모든 서버가 메시지를 수신하고 처리한다. 서버가 10대면 9대가 불필요한 처리를 한다.


## 데이터 특성 분석 — 이 메시지는 전체 이벤트인가

여기서 전달하려는 데이터의 성격을 다시 봤다.

Broadcast가 적합한 데이터가 있다. 2편에서 다뤘던 Kafka 이벤트처럼, 모든 서버가 알아야 하는 상태 변경은 전체 전달이 맞다.

하지만 채팅 메시지 전달에 같은 질문을 던져보면 답이 달라진다.

- 모든 서버가 이 메시지를 반드시 알아야 하는가? → 아니다. 대상 유저가 연결된 서버만 알면 된다.
- 목적지가 이미 하나인데 왜 전체에 전달해야 하는가? → 세션 위치를 모르기 때문에 전부 보내는 것이다.
- 이 데이터는 Event인가, Delivery인가? → 시스템 상태를 알리는 이벤트가 아니라, 특정 유저에게 도달해야 하는 전달이다.

채팅 메시지는 목적지가 명확한 데이터다. 세션 위치만 알 수 있다면, 전체 서버에 뿌릴 이유가 없다.


## 트레이드오프 비교 — Pub/Sub vs Target Routing

| 기준 | Pub/Sub | Target Routing |
|-|-|-|
| 전달 방식 | 모든 서버에 전달 | 목적 서버에만 전달 |
| 구현 난이도 | 낮음 | 높음 |
| 세션 위치 관리 | 필요 없음 | 필요 |
| 불필요한 처리 | 서버 수에 비례하여 증가 | 최소화 |

Pub/Sub은 단순하지만 서버가 증가할수록 불필요한 비용이 함께 증가한다. Target Routing은 세션 위치 관리라는 복잡성이 추가되지만, 메시지가 필요한 서버만 처리한다.


## 선택 — Redis Session Registry + Target Routing

Redis에 유저별 연결 서버 정보(`ws:user:server:{userId} → serverId`)를 저장한다. 메시지 전달 시 로컬 세션이 있으면 WebSocket으로 직접 전달, 없으면 Redis에서 대상 서버를 조회한 뒤 해당 서버로 전달하는 구조를 짰다.

Target Routing을 도입하면 서버 간 직접 통신이 필요하다. 채팅 메시지는 고빈도로 발생하는 작은 데이터이므로, 지속 연결을 재사용하고 바이너리 직렬화를 사용하는 gRPC를 서버 간 통신 수단으로 선택했다.


## 구현

```java
// WebSocketHandler.java — sendMessageToChatRoom()
userIdsInChat.parallelStream().forEach(userId -> {
    WebSocketSession receiverSession = sessionManager.getSession(userId);

    if (receiverSession != null && receiverSession.isOpen()) {
        // 같은 서버 — WebSocket 직접 전달
        receiverSession.sendMessage(textMessage);
    }
    else {
        String targetServerId = redisTemplateForString.opsForValue()
                .get(USER_SERVER_KEY_PREFIX + userId);

        if (targetServerId != null && !targetServerId.equals(serverIdentifier)) {
            // 다른 서버 — gRPC 릴레이
            relayMessageViaGrpc(targetServerId, message, userId);
        }
    }
});
```

Target Routing의 분기가 이 코드에서 이루어진다. 로컬 세션이 있으면 WebSocket, 없으면 Redis 조회 후 gRPC. 메시지가 어떤 경로로 전달되는지는 유저의 연결 위치에 따라 결정된다.

### 한계

이번 구조는 목적 서버가 정상적으로 동작하는 상황을 가정한다. 서버 장애나 gRPC 실패 상황에서는 메시지가 유실될 수 있으므로, UndeliveredMessage 저장과 FCM 알림을 이용한 보완 전략을 추가로 도입할 것을 고려하고 있다. 


## 검증 — Target Routing 동작 확인

같은 채팅방에서 보낸 메시지가 유저의 연결 위치에 따라 다른 경로로 전달되는지 확인했다.

```
[ 같은 서버일 경우 ]

User A
    │
    ▼
chat-server-1
    │
    ▼
WebSocket
    │
    ▼
User B

---
[ 다른 서버일 경우 ]

User A
    │
    ▼
chat-server-1
    │
Redis lookup
    │
    ▼
gRPC Relay
    │
    ▼
chat-server-2
    │
    ▼
WebSocket
    │
    ▼
User C
```

**테스트 환경**
- chat-server-1 (local1): port 8081, gRPC 9191
- chat-server-2 (local2): port 8082, gRPC 9192

**연결 상태:**

| 유저 | 연결 서버 |
|-|-|
| User A | local1 |
| User B | local1 |
| User C | local2 |

User A가 메시지를 전송하면, 같은 서버(local1)의 User B는 WebSocket 직접 전달, 다른 서버(local2)의 User C는 gRPC 릴레이가 발생해야 한다.

**local1 로그:**
```
로컬 메시지 전송 성공. 수신자 ID: 198117270034059264
다른 서버로 메시지 릴레이 시도. 수신자 ID: 198117707709681664, 대상 서버: local2
```

**local2 로그:**
```
gRPC relayMessage 요청 수신: senderId: 198115577452040192
gRPC -> WebSocket 메시지 릴레이 성공. 수신자 ID: 198117707709681664
```

같은 메시지를 보냈지만 전달 경로가 달랐다. 
같은 서버의 유저는 WebSocket 직접 전달, 
다른 서버의 유저는 Redis 조회 → gRPC 릴레이. 

메시지는 더 이상 모든 서버로 브로드캐스트되지 않는다. 연결 위치를 기준으로 목적 서버 하나만 선택해 전달된다.

## 같은 패턴, 다른 레이어

| 편 | 문제 | 데이터 특성 | 선택 |
|-|-|-|-|
| 1편 | Race Condition | 단조 증가 (max) | 분산 락 대신 Lua Script |
| 2편 | Kafka 순서 역전 | 토픽별 순서 요구 차이 | chat-message만 Key 사용 |
| 3편 | 복제 지연 | 읽기별 최신성 요구 차이 | R/W Routing |
| 4편 | Redis 장애 | 기능별 피해 대상 차이 | Fail 전략 분리 |
| 5편 | ID 생성 | 정렬/비교 기준으로 사용 | Snowflake |
| 6편 | WebSocket Scale-Out | 목적지가 명확한 데이터 | Broadcast 대신 Target Routing |


## 마무리

Broadcast를 포기한 이유는 채팅 메시지는 목적지가 명확한 데이터였고, 전체 서버에 뿌리는 것은 그 특성에 맞지 않았다. Target Routing을 선택하면서 서버 간 통신이 필요해졌고, gRPC는 그 구현 수단이었다.