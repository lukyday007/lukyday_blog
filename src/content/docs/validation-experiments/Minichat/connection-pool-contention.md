---
title: 풀 크기를 늘렸다면 해결됐을까?
description: "커넥션 풀 고갈의 진짜 원인 찾기 — 두 번의 가설과 두 번의 반증"
sidebar:
  order: 1
date: 2026-07-24

tags:
  - Performance Testing
  - Connection Pool
  - HikariCP
  - Database
  - Minichat
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: July 24, 2026</p>

## 의심한 지점

Minichat 코드를 다시 보다가 채팅방 생성 로직이 눈에 걸렸다.

```java
@Transactional
public ChatResponseDTO createChat(Long creatorId, ChatRequestDTO dto) {
    chatRepository.save(chat);                              // 1건
    associateUsersWithChat(chat, users);                    // 인원수만큼
    messageService.createSystemEntryMessage(chat, users);   // 1건
    publishSystemMessageToKafka(chat.getId(), systemMessage);
}
```

방 하나 만들 때 INSERT가 최소 3건, 초대 인원이 50명이면 52건이 들어간다. 게다가 Kafka로 메시지를 보내는 부분까지 `@Transactional` 안에 있었다.

SQL을 수행해 커넥션을 획득한 이후에는 트랜잭션이 끝날 때까지 반환되지 않는다. 안에 오래 걸리는 작업이 있으면 그만큼 커넥션이 반환되지 않는다는 뜻이다. 요청이 몰릴 때 풀이 마를 수도 있겠다는 생각이 들었고, 실제로 그런지 확인해보고 싶어졌다.


## 첫 번째 가설

> 트랜잭션 안의 Kafka produce가 커넥션 점유 시간을 늘린다.
> 점유가 길어지면 Pending Threads가 더 낮은 부하에서 발생한다.

코드를 읽고 세운 가설이다. 진짜 그런지는 돌려봐야 알 수 있을 것 같아서 측정 환경부터 준비했다.

## 측정 환경

| 항목 | 값 |
| --- | --- |
| 서버 인스턴스 | 3대 (local1 / local2 / local3) |
| 커넥션 풀 | HikariCP, `maximumPoolSize=20`, `minimumIdle=20` |
| DataSource | Master-Replica 라우팅 + `LazyConnectionDataSourceProxy` |
| 부하 도구 | k6, `constant-vus` 30초 |
| 모니터링 | Prometheus + Grafana |

Grafana에 HikariCP 관련 패널 세 개를 새로 추가했다.

| 패널 | 쿼리 |
| --- | --- |
| Active Connections | `hikaricp_connections_active` |
| Pending Threads | `hikaricp_connections_pending` |
| Usage Time | `hikaricp_connections_usage_seconds_max` |

*`hikaricp_connections_pending` — 커넥션을 못 얻어서 기다리는 스레드 수. 이 값이 0을 넘으면 이미 풀이 부족하다는 뜻이다.*
*`usage_seconds_max` — 일정 시간 동안 관측된 최댓값이 서서히 감쇠하는 지표. 평균이 아니라 "최악의 한 건"이 얼마였는지를 보여준다.*

Prometheus의 `scrape_interval`은 기본값 15초에서 1초로 낮췄다. 트랜잭션 하나가 몇백 ms 안에 끝나버리는데 15초에 한 번씩만 값을 찍으면 그 사이에 뭐가 일어났는지 잡을 수가 없다. Pending이 0으로 보일 때 그게 정말 대기가 없었던 건지, 아니면 그냥 스캔 타이밍에 안 걸린 건지 구분이 안 된다. 그래서 주기를 짧게 잡았다.

```yaml
global:
  scrape_interval: 1s
  evaluation_interval: 5s
```

## 첫 측정이 실패한 이유

기존에 작성해둔 메시지 파이프라인 테스트로 부하를 걸었다. 유저 60명이 30초 동안 TALK 메시지 1,200건을 전송하는 시나리오다.

| 지표 | 값 |
| --- | --- |
| Heap 사용률 | 1.9% |
| CPU 사용률 | 0.179 |
| Active Connections | 0 |
| Pending Threads | 0 |

부하 자체가 서버에 거의 도달하지 않은 것처럼 보였다. 뭐가 문제인지 짚어보니 두 가지가 겹쳐 있었다.

**Kafka produce 결과를 대기하지 않았다.** `kafkaTemplate.send()`는 `CompletableFuture`를 즉시 반환한다. 코드에서 `.get()`으로 결과를 기다리지 않으므로, 트랜잭션은 Kafka 응답을 대기하지 않고 종료된다. 커넥션이 오래 잡혀 있을 이유가 없었던 거다. 즉, 첫 번째 가설은 틀렸다. 
`send()`가 항상 논블로킹인 것은 아니다. 프로듀서 내부 버퍼가 가득 차면 설정된 시간만큼 실제로 블로킹된다. 다만 이번 부하 정도로는 그 상황까지 가지 않았다.

**측정 대상이 잘못됐다.** TALK 메시지 하나 보내는 트랜잭션은 INSERT 1건짜리다. 정작 무거운 `createChat`은 테스트 스크립트의 `setup()` 단계에서 15회만 순차로 돌고 끝났다. 부하 시나리오 본문에는 아예 들어가 있지도 않았다.
측정하려던 대상이 시나리오 안에 없었다.


### 측정 대상 재설정

이번엔 `createChat`을 부하 시나리오 본문 안으로 옮긴 스크립트를 새로 짰다. 각 VU가 30초 동안 계속 방을 만드는 구조다.

두 개의 변수를 환경변수로 분리했다.

| 변수 | 조절 대상 |
| --- | --- |
| `MEMBERS` | 트랜잭션당 INSERT 건수 |
| `VUS` | 동시 요청 수 |

```bash
k6 run -e MEMBERS=20 -e VUS=30  connection-pool-test.js
k6 run -e MEMBERS=50 -e VUS=100 connection-pool-test.js
```

축을 이렇게 나눈 이유는, 다음에 세운 가설을 확인해보기 위해서였다.

## 두 번째 가설

> 트랜잭션이 무거우면 커넥션 점유 시간이 길어진다.
> 따라서 더 낮은 동시 요청 수에서 Pending Threads가 발생한다.

`MEMBERS`를 20에서 50으로 올리면 같은 VU에서도 고갈이 앞당겨질 것으로 예상했다.

## 6조합 기준선

`MEMBERS` 2종, `VUS` 3종을 조합해서 총 6개 조건을 각각 30초씩 돌려봤다.

### MEMBERS=20 (트랜잭션당 22 INSERT)

| VU | 서버당 동시요청 | Active | Pending | 처리량 | p95 | median |
| --- | --- | --- | --- | --- | --- | --- |
| 30 | 10 | 10 | 0 | 140.98/s | 158ms | 85ms |
| 60 | 20 | 20 | 0 | 217.43/s | 253ms | 137ms |
| 100 | 33 | 20 | **11** | 234.64/s | 422ms | 275ms |

### MEMBERS=50 (트랜잭션당 52 INSERT)

| VU | 서버당 동시요청 | Active | Pending | 처리량 | p95 | median |
| --- | --- | --- | --- | --- | --- | --- |
| 30 | 10 | 10 | 0 | 68.26/s | 356ms | 239ms |
| 60 | 20 | 20 | 0 | 97.36/s | 569ms | 389ms |
| 100 | 33 | 20 | **14** | 103.57/s | 892ms | 672ms |

6번 다 돌리는 동안 실패한 요청은 하나도 없었다.

VU는 서버 3대로 나뉘어서 들어가니까, 서버 하나당 받는 동시 요청은 `VU ÷ 3`이 된다. Active Connections 값이 딱 그 숫자를 따라 움직였고, 풀 크기인 20까지 올라가면 거기서 멈췄다.

<div style="display:flex; gap:16px; margin:24px 0;">
  <img
    src="/images/validation-experiments/connection-pool-contention/MEMBERS20_VU100_pending.png"
    alt="MEMBERS20_VU100_pending"
    width="48%"
  />
  <img
    src="/images/validation-experiments/connection-pool-contention/MEMBERS20_VU100_usage_time.png"
    alt="MEMBERS20_VU100_usage_time"
    width="48%"
  />
</div>


## Pending은 무엇에 반응하는가

두 번째 짐작도 맞지 않았다.

| 조건 | 서버당 요청 | 트랜잭션당 INSERT | Pending |
| --- | --- | --- | --- |
| MEMBERS=20, VU60 | 20 | 22 | 0 |
| MEMBERS=50, VU60 | 20 | 52 | **0** |
| MEMBERS=20, VU100 | 33 | 22 | 11 |
| MEMBERS=50, VU100 | 33 | 52 | 14 |

트랜잭션 안에서 나가는 INSERT를 2.4배로 늘려도, VU60일 때 Pending은 그대로 0이었다. 오히려 VU를 60에서 100으로 올리자 양쪽 다 Pending이 잡히기 시작했다.

<div style="display:flex; gap:16px; margin:24px 0;">
  <img
    src="/images/validation-experiments/connection-pool-contention/MEMBERS50_VU60_pending.png"
    alt="MEMBERS50_VU60_pending"
    width="48%"
  />
  <img
    src="/images/validation-experiments/connection-pool-contention/MEMBERS50_VU60_usage_time.png"
    alt="MEMBERS50_VU60_usage_time"
    width="48%"
  />
</div>

요청 하나는 오래 걸리든 짧게 걸리든 커넥션을 하나만 쓴다. 서버당 동시에 들어온 요청이 20개고 풀이 20개면, 모두가 하나씩 나눠 받아서 기다릴 사람이 없다. 결국 Pending은 `동시 요청 수 > 풀 크기`일 때만 나타나는 지표다.

다만 이 결과에는 부하 방식이 작용한다. `constant-vus`는 VU가 응답을 받은 뒤 다음 요청을 보내므로 동시 요청 수가 VU 수로 고정된다. 트랜잭션이 느려지면 요청 간격만 벌어질 뿐 동시 요청 수가 늘어나지는 않는다.

실제 서비스는 다르다. 요청 도착률이 응답 시간이랑 상관없이 계속 밀려들어오니까, 트랜잭션이 느려지면 처리 중인 요청이 쌓여서 동시 요청 수 자체가 늘어난다. 그 상황이면 트랜잭션이 무거운 게 결국 Pending으로 이어지기도 한다.

### 그럼 왜 느려진 걸까

Pending이 0인 구간끼리 비교해보면 답이 나온다.

| 조건 | Pending | 처리량 | p95 | Usage Time |
| --- | --- | --- | --- | --- |
| MEMBERS=20, VU60 | 0 | 217.43/s | 253ms | 0.25초 |
| MEMBERS=50, VU60 | 0 | 97.36/s | 569ms | 0.8초 |

커넥션은 아직 남는데도 처리량이 절반 가까이 떨어졌고, 지연은 두 배 넘게 늘어난 거다.
결국 두 지표는 서로 다른 걸 보고 있었다.

- **Pending Threads** — 동시 요청이 풀 크기를 넘었는가
- **Usage Time / 처리량** — 트랜잭션 안에서 얼마나 오래 붙잡고 있는가

이걸 구분하는 게 왜 중요하냐면, 어디를 고쳐야 하는지가 달라지기 때문이다. 만약 Pending만 보고 판단했으면 "풀 크기를 40으로 늘리면 되겠네" 했을 거다. 그런데 MEMBERS=50 VU60 구간은 풀에 여유가 있는데도 p95가 이미 569ms였다. 여기는 풀을 늘려도 아무것도 나아지지 않는다.

## 반복 save의 비용

트랜잭션 개수만 놓고 보면 MEMBERS=50 쪽이 절반밖에 안 되는데, INSERT를 다 세어보면 오히려 이쪽이 DB한테 더 많은 일을 시키고 있었다.

| 조건 | 트랜잭션 수 | INSERT 총량 | 초당 INSERT |
| --- | --- | --- | --- |
| MEMBERS=20, VU100 | 7,802 | 171,644 | 약 5,720/s |
| MEMBERS=50, VU100 | 3,916 | 203,632 | 약 6,790/s |

초당 6,000~7,000건 근처에서 딱 막혀 있었다. 왜 여기서 막히는지 찾아보니, 유저를 채팅방에 연결해주는 코드에 원인이 있었다.

```java
private void associateUsersWithChat(Chat chat, List<User> users) {
    for (User user : users) {
        UserChat userChat = new UserChat();
        userChat.setId(userChatIdGenerator.generate());
        userChat.setUser(user);
        userChat.setChat(chat);
        userChatRepository.save(userChat);   // 인원수만큼 반복
    }
}
```

50명짜리 방을 하나 만들면 `save()`가 50번 불린다. 배치 설정을 따로 안 해두면 Hibernate가 flush 시점에 INSERT 50개를 하나씩 개별로 날리는데, 그만큼 DB에 갔다 오는 왕복이 쌓인다. 트랜잭션은 이 50번이 다 끝날 때까지 커넥션을 놓지 않고 계속 붙잡고 있다.

위의 구조가 Usage Time이 0.8초까지 치솟은 주요 원인으로 판단했다.


## 배치 전환

두 곳을 변경했다.

```java
private void associateUsersWithChat(Chat chat, List<User> users) {
    List<UserChat> userChats = users.stream()
            .map(user -> {
                UserChat userChat = new UserChat();
                userChat.setId(userChatIdGenerator.generate());
                userChat.setUser(user);
                userChat.setChat(chat);
                return userChat;
            })
            .toList();

    userChatRepository.saveAll(userChats);
}
```

```yaml
spring:
  jpa:
    properties:
      hibernate:
        jdbc:
          batch_size: 50
        order_inserts: true
```

여기서 주의할 게, `saveAll()`만 바꾸고 `batch_size` 설정을 안 걸어두면 안쪽에서는 여전히 INSERT가 하나씩 나간다. 두 개를 같이 적용해야 진짜로 배치가 묶여서 나간다.


## 개선 전후

가장 부하가 높은 조건(MEMBERS=50, VUS=100)으로 재측정했다.

| 지표 | 개선 전 | 개선 후 | 변화 |
| --- | --- | --- | --- |
| 처리량 | 103.57/s | 175.06/s | +69% |
| 생성된 방 수 | 3,916 | 6,699 | +71% |
| p95 | 892ms | 555ms | -38% |
| median | 672ms | 325ms | -52% |
| 평균 | 672ms | 350ms | -48% |
| 초당 INSERT | 약 6,790 | 약 11,610 | +71% |

p95 수치도 중요하지만, median이 더 크게 줄었다는 게 눈에 띄었다. 몇몇 튀는 케이스만 좋아진 게 아니라, 평범한 요청들이 전반적으로 다 빨라졌다는 뜻이기 때문이다.

### 개선 전
<div style="display:flex; gap:16px; margin:24px 0;">
  <img
    src="/images/validation-experiments/connection-pool-contention/MEMBERS50_VU100_pending.png"
    alt="MEMBERS50_VU100_pending"
    style="flex:1; width:0; min-width:0; height:auto;"
  />
  <img
    src="/images/validation-experiments/connection-pool-contention/MEMBERS50_VU100_usage_time.png"
    alt="MEMBERS50_VU100_usage_time"
    style="flex:1; width:0; min-width:0; height:auto;"
  />
</div>

### 개선 후
<div style="display:flex; gap:16px; margin:24px 0;">
  <img
    src="/images/validation-experiments/connection-pool-contention/After_pending.png"
    alt="After_pending"
    style="flex:1; width:0; min-width:0; height:auto;"
  />
  <img
    src="/images/validation-experiments/connection-pool-contention/After_usage_time.png"
    alt="After_usage_time"
    style="flex:1; width:0; min-width:0; height:auto;"
  />
</div>

그래프만 보면 개선 후에도 Pending과 Usage Time 최댓값이 별로 안 줄어 보인다. 이 두 지표는 "그 순간 가장 나빴던 값"을 보여주는 거라 그렇다. 실제로 달라진 건 같은 30초 동안 처리한 요청 수, 그리고 median 지연이다.


## 두 개의 축

이 실험에서 세운 가설은 두 번 모두 틀렸다.

첫 번째는 트랜잭션 안에서 외부 I/O를 하면 커넥션을 오래 붙잡고 있을 거라 예상했다. 그런데 Kafka produce가 결과를 안 기다리는 방식이라 커넥션이 딱히 잡혀 있지 않았다. 코드만 봐서는 알 수 없는 부분이었다.

두 번째는 트랜잭션 안에서 하는 일이 많으면 커넥션 고갈이 더 빨리 올 거라 생각했다. 그런데 이번 실험 범위에서는 Pending이 트랜잭션이 무거운 것보다 동시 요청 수에 더 반응했다.

정리하면 다음과 같다.

- Pending Threads는 동시 요청 수와 풀 크기의 관계에서 생기는 지표다.
- Usage Time이랑 처리량은 트랜잭션 안에서 하는 일 자체가 얼마나 오래 걸리는지 보여준다.
- 두 지표는 서로 다른 걸 재고 있고, 하나만 보고 다른 하나를 판단할 수 없다.

풀 크기를 늘리는 것보다 DB 왕복을 줄이는 것이 먼저였다. 실제로 돌려보고 재보지 않았다면, 코드 구조만 보고 엉뚱한 곳을 고쳤을 거다.
