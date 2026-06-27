---
title: Kafka 순서 보장은 언제 필요할까?
description: "같은 Kafka, 같은 프로젝트에서 한 토픽은 순서를 보장하고 다른 토픽은 순서를 포기한 이유를 정리한다."
sidebar:
  order: 2
date: 2026-06-25

tags:
  - Kafka
  - Partitioning
  - Ordering
  - Concurrency
  - Minichat
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: June 25, 2026</p>


## 배경 — 메시지 전송 후의 두 가지 비동기 처리

Minichat에서 유저가 메시지를 보내면 두 가지 작업이 비동기로 발생한다.

하나는 **실시간 전달**이다. 전송된 메시지를 같은 채팅방에 접속한 유저들에게 WebSocket으로 브로드캐스트한다. `chat-message` 토픽이 이 역할을 담당한다.

다른 하나는 **DB 상태 갱신**이다. 채팅방의 `lastWrittenMessageId`를 최신 메시지 ID로 갱신하여, 채팅방 목록에서 마지막 메시지를 표시하거나 안 읽은 메시지 수를 계산하는 데 사용한다. `user-chat-update` 토픽이 이 역할을 담당한다.

두 작업 모두 Kafka를 통해 처리한다.


## 문제 — Kafka 순서 역전

Kafka는 파티션이 여러 개일 때 메시지 순서를 보장하지 않는다. Producer가 보낸 순서와 Consumer가 받는 순서가 다를 수 있다.

**chat-message 토픽에서 순서가 뒤집히면:**

유저 A가 "안녕" → "뭐해?"를 순서대로 보냈는데, 다른 유저의 화면에 "뭐해?" → "안녕" 순서로 나타난다. 대화 흐름이 깨진다.

**user-chat-update 토픽에서 순서가 뒤집히면:**

| 시점 | Consumer 처리 | lastWrittenMessageId |
|------|-------------|---------------------|
| T1   | 메시지 A (id=170) 수신 → UPDATE | 170 |
| T2   | 메시지 B (id=150) 수신 → UPDATE | 150 ← 역전 |

메시지 A(id=170)가 먼저 전송되고 메시지 B(id=150)가 나중에 전송됐는데, Consumer가 B → A 순서로 처리하면 `lastWrittenMessageId`가 150 → 170으로 갱신된다. 이 경우는 문제가 없다.

하지만 A → B 순서로 처리되면? 170 → 150으로 덮어쓰여진다. 채팅방 목록에 더 오래된 메시지가 표시된다.

두 토픽 모두 순서 역전의 가능성이 있다.


## 초기 판단 — 두 토픽 모두 Key 사용

Kafka에서 순서를 보장하는 방법은 같은 Key를 가진 메시지를 같은 파티션에 넣는 것이다. 파티션 내에서는 순서가 보장되기 때문이다.

두 토픽 모두 `chatId`를 Key로 사용하면 같은 채팅방의 이벤트가 같은 파티션에 들어가고, Consumer는 순서대로 처리할 수 있다.

하지만 순서 보장에는 비용이 따른다. Key를 사용하면 같은 Key의 메시지가 하나의 파티션에 몰리고, 해당 파티션의 Consumer가 직렬로 처리해야 한다. 두 토픽 모두 이 비용을 감수할 필요가 있는지 의문이었다.


## 데이터 특성 분석

두 토픽의 Consumer가 처리하는 데이터의 성격이 다르다.

- **chat-message :** Consumer가 WebSocket으로 메시지를 브로드캐스트한다. 유저 화면에 보이는 순서 자체가 사용자 경험이다. 순서 역전은 대화 흐름을 직접 파괴한다.

- **user-chat-update :** Consumer가 `lastWrittenMessageId`를 DB에 갱신한다. 이 값은 1편에서 분석한 것과 같은 구조다. 메시지 ID가 Snowflake 기반으로 단조 증가하므로, 최종적으로 max 값만 유지하면 된다. 중간 순서가 뒤바뀌어도 결과에 영향이 없다.


## 트레이드오프 비교

데이터 성격은 파악했다. 그렇다면 순서를 얻기 위해 파티션 병렬성을 포기할 가치가 있는가?

- **Key를 사용하면:** 같은 `chatId`의 이벤트가 같은 파티션에 들어간다. 해당 파티션의 Consumer가 직렬로 처리하므로 순서가 보장된다. 대신 특정 파티션에 부하가 몰릴 수 있다.

- **Key를 사용하지 않으면:** 라운드 로빈으로 파티션에 분배된다. 파티션 간 부하가 균등해지지만, Consumer가 받는 순서는 보장되지 않는다. 순서가 깨져도 되는 구조가 전제되어야 한다.

| 기준 | Key 사용 | Key 미사용 |
|-|-|-|
| 순서 보장 | 파티션 내 보장 | 없음 |
| 부하 분산 | Key 분포에 의존 | 균등 |
| 전제 조건 | 없음 | 데이터가 순서 무관해야 함 |


## 선택

**chat-message:** `chatId`를 Key로 사용한다. 유저 화면에 보이는 대화 순서가 곧 사용자 경험이므로, 병렬성을 포기하더라도 순서 보장이 필수다.

<br>

**user-chat-update:** Key를 사용하지 않는다. `lastWrittenMessageId`는 max 문제이므로, Consumer 쪽의 조건부 UPDATE가 순서 역전을 흡수한다. 순서를 포기하는 대신 병렬성을 확보한다.


## 구현

**ChatMessageProducer.java — Key 사용**

```java
public void send(MessageSendEvent event) {
    String key = String.valueOf(event.getTalkMessage().getChatId());
    kafkaTemplate.send(TOPIC, key, event);
}
```

`chatId`를 Key로 전달한다. 같은 채팅방의 메시지는 같은 파티션에 들어가고, Consumer는 순서대로 WebSocket에 브로드캐스트한다.

**UserChatUpdateProducer.java — Key 미사용**

```java
public void sendUserChatUpdateEvent(UserChatUpdateEvent event) {
    kafkaTemplate.send(TOPIC, event);
}
```

Key 없이 전송한다. Kafka가 라운드 로빈으로 파티션에 분배한다.

**UserChatUpdateConsumer.java — 조건부 UPDATE**

```java
public void consume(UserChatUpdateEvent event) {
    List<Long> userChatIds = userChatRepository.findIdsByChatId(event.getChatId());
    if (userChatIds.isEmpty()) return;

    userChatJdbcRepository.batchUpdateLastWrittenMessage(
            userChatIds,
            event.getLastMessageId(),
            event.getTimestamp()
    );
}
```

Consumer가 호출하는 `batchUpdateLastWrittenMessage`의 SQL:

```sql
UPDATE user_chat
SET last_written_message_id = ?, last_message_timestamp = ?
WHERE id = ? AND is_deleted = false
  AND (last_written_message_id IS NULL OR last_written_message_id < ?)
```

`WHERE last_written_message_id < ?` 조건이 순서 역전을 흡수한다. 이미 더 큰 값이 기록되어 있으면 UPDATE가 실행되지 않는다.


## 검증 — 순서 역전 시 최종 상태

Key 없이 전송한 이벤트가 순서 역전되어도 조건부 UPDATE가 최종 상태를 보장하는지 확인했다.

**테스트 환경**
- Kafka: localhost:9092, 파티션 3개
- DB: H2 인메모리
- Spring Boot 3.3.1 + Spring Kafka

### 시나리오 1: 5건 셔플

전송 순서: `[150, 130, 170, 120, 160]` — Key 없이 전송.

| 수신 순서 | messageId | 결과 |
|-|-|-|
| #1 | 120 | UPDATE |
| #2 | 160 | UPDATE |
| #3 | 150 | SKIP |
| #4 | 130 | SKIP |
| #5 | 170 | UPDATE |

최종 DB 값: **170** ✅

Consumer가 받은 순서(120 → 160 → 150 → 130 → 170)는 전송 순서(150 → 130 → 170 → 120 → 160)와 다르다. 하지만 `WHERE < ?` 조건 덕분에 더 작은 값(150, 130)은 SKIP되고, 최종값은 max인 170이 된다.

### 시나리오 2: 100건 셔플

1~100을 셔플하여 Key 없이 전송.

| 항목 | 수치 |
|-|-|
| UPDATE 횟수 | 7 |
| SKIP 횟수 | 93 |
| 최종 DB 값 | **100** ✅ |

100건 중 93건이 SKIP됐다. 순서 역전이 발생해도 조건부 UPDATE가 항상 max 값만 남긴다.


## 같은 패턴, 다른 레이어

1편에서 Redis의 `lastReadMessageId`를 Lua Script로 갱신할 때 사용한 패턴이 여기서도 동일하게 적용된다.

| 편 | 레이어 | 데이터 | 갱신 방식 |
|-|-|-|-|
| 1편 | Redis | `lastReadMessageId` | Lua Script: `if ARGV[1] > current` |
| 2편 | DB | `lastWrittenMessageId` | SQL: `WHERE last_written_message_id < ?` |

두 경우 모두 Snowflake ID의 단조 증가가 전제이고, "현재 값보다 큰 경우에만 갱신"이라는 동일한 규칙이 적용된다. 1편에서는 이 패턴이 분산 락을 대체했고, 2편에서는 Kafka의 순서 보장을 대체했다.


## 마무리

같은 Kafka, 같은 프로젝트에서 한 토픽은 순서를 보장하고 다른 토픽은 순서를 포기했다. 데이터 특성이 다르면 같은 인프라에서도 전략이 달라진다.