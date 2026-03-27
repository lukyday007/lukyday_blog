---
title: 프롤로그 - 대용량 처리(Large-scale Processing)란 무엇인가?
description: 대용량 처리의 본질, 4가지 황금 신호(Golden Signals), 그리고 제약이론(TOC)의 결합
sidebar:
  order: 1
date: 2026-03-18
---
<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">작성일: 2026년 3월 18일</p>

> 2025년 10월 새벽 3시, AWS 서버 하나의 DNS 설정 오류로 Snapchat, Roblox, McDonald's 앱이 동시에 먹통이 되었다. 전 세계 60개국, 3,500개 기업이 이 작은 균열 하나로 동시에 멈췄다. 
> 
> 시스템은 우리가 상상하는 것보다 훨씬 취약하다. 대용량 처리는 단순히 서버 성능을 높이는 기술적 유행이 아니다. 자원 임계점이라는 벼랑 끝에서 서비스의 생존을 지켜내기 위한 엔지니어링의 본질이다.

<br>
<br>

그렇다면 "대용량"은 어디서부터인가? 사용자 1만 명? 100만 명? 사실 이 질문 자체가 잘못되었다. 대용량은 절대적인 숫자가 아니다. **시스템이 가진 자원의 임계점을 넘어서는 순간**, 그것이 대용량이다. 카카오의 일상 트래픽이 스타트업에게는 재앙이 되는 이유가 여기에 있다.

이 시리즈는 그 임계점을 어떻게 감지하고, 왜 무너지며, 어떻게 버텨내는지를 다룬다.

<br>

### 서버가 비명을 지르기 전 신호들

무너지는 시스템은 갑자기 쓰러지지 않는다. 반드시 전조가 있다. Google SRE팀은 이를 **4가지 황금 신호(Four Golden Signals)**로 정의한다.

<div style="text-align: right; margin-top: -0.5rem;">  
    <a href="https://sre.google/sre-book/monitoring-distributed-systems/">Google SRE: Monitoring Distributed Systems</a>
</div>

* **지연 시간 (Latency):** 요청을 처리하는 데 걸리는 시간. 성공/실패 여부에 따른 속도 차이를 추적하여 시스템 이상 징후를 파악한다.
* **트래픽 (Traffic):** 시스템에 가해지는 수요의 양. 초당 HTTP 요청 수(RPS) 등으로 측정한다.
* **오류 (Errors):** 명시적 혹은 암시적으로 실패한 요청의 비율이다.
* **포화도 (Saturation):** 시스템의 자원이 얼마나 "꽉 찼는지"를 나타낸다. 대용량 처리의 가장 직접적인 지표이며, 지연 시간의 증가는 종종 포화도의 전조 현상으로 나타난다.

이 네 가지 신호 중 하나라도 이상하다면, 시스템은 이미 한계에 다가서고 있다는 뜻이다.


<br>

### 그래서 무엇이 "많은" 건가?

황금 신호가 시스템의 **상태**를 알려준다면, 엔지니어는 부하의 **성격**을 파악해야 한다. 같은 "대용량"이라도 무엇이 많은지에 따라 전략이 완전히 달라진다.

**트래픽 (Traffic: 요청이 많을 때)**
단위 시간당 얼마나 많은 요청이 들어오는가, 그리고 얼마나 많은 연결을 유지할 수 있는가를 측정한다.
* **TPS / QPS:** 초당 처리되는 트랜잭션 또는 쿼리 수. 시스템의 실질적인 생산성을 나타낸다.
* **Concurrency:** 동일 시점에 유지되는 연결(Connection) 수. 티켓팅이나 이벤트 상황에서 시스템의 수용량을 결정짓는 핵심 요소다.

**데이터 양 (Volume: 데이터가 많을 때)**
시스템이 처리해야 할 데이터의 물리적 크기와 전송 능력을 의미한다.
* **Throughput:** 단위 시간당 전송되는 데이터 크기(MB/s). 대용량 파일 전송이나 미디어 스트리밍 환경에서 시스템의 병목을 결정짓는다.

**복잡도 (Complexity: 처리가 복잡할 때)**
요청 하나를 처리하기 위해 필요한 연산량과 시스템 간 상호작용의 수준이다.
* **Logic Latency:** 로직이 복잡해질수록 응답 시간이 길어지며, 이는 곧 포화도(Saturation)의 급격한 상승으로 이어진다.

실제 장애는 이 셋이 동시에 터진다. 하지만 원인을 분리하지 못하면 해결책도 없다.


<br>


### 경영학의 언어로 엔지니어링을 읽다

공장 라인에서 가장 느린 기계 하나가 전체 생산량을 결정한다. 
아무리 나머지 공정을 빠르게 해도 소용없다. 

엘리야후 골드랫(Eliyahu M. Goldratt)이 제시한 경영 관리 패러다임이다. "시스템의 전체 산출물은 가장 취약한 사슬, 즉 <strong>제약 요인(Constraint)</strong>에 의해 결정된다"는 것이 핵심이다.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.lean.org/lexicon-terms/theory-of-constraints/">Lean Enterprise Institute: TOC</a>
</div>
<br>

서버도 똑같다. <strong>포화도(Saturation)가 100%에 
가장 먼저 도달하는 지점이 바로 병목(Bottleneck)이다.</strong> 
트래픽이 늘어날 때 어느 지점의 포화도가 가장 먼저 치솟는지 파악하고, 
그 제약 요인을 적절한 전략으로 해소하는 것. 
이것이 대용량 처리의 정수다.


<br>

### 엔지니어링 전략: 확장성(Scalability)

병목을 찾았다면 이제 수용량을 늘려야 한다. 선택지는 두 가지다.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.geeksforgeeks.org/overview-of-scaling-vertical-and-horizontal-scaling/">GeeksforGeeks: Vertical and Horizontal Scaling</a>
</div>

* **수직적 확장 (Scale-up):** 단일 노드의 CPU, RAM 등 사양을 높여 해당 지점의 포화도를 낮춘다. 빠르지만 한계가 있고, 비싸다.
* **수평적 확장 (Scale-out):** 노드의 개수를 늘려 부하를 분산하고 전체 시스템의 처리량(Throughput)을 늘린다. 복잡하지만 이론상 무한히 확장 가능하다.

```
  [Single Server]         [Multiple Servers]
                                        
  ┌─────────────┐         ┌───┐ ┌───┐ ┌───┐
  │   CPU ↑↑↑   │         │ S │ │ S │ │ S │
  │   RAM ↑↑↑   │    →    │ 1 │ │ 2 │ │ 3 │
  │   SSD ↑↑↑   │         └───┘ └───┘ └───┘
  └─────────────┘           Load Balancer
  
      Scale-up                Scale-out
      (한계 존재)              (수평 확장 가능)
```
Scale-up은 복잡도를 포기하는 대신 속도를 산다.
Scale-out은 단순함을 포기하는 대신 한계를 없앤다.
정답은 없다. 지금 병목이 어디인지가 선택을 결정한다.

<br>

### 앞으로

결국 대용량 처리는 **포화도(Saturation)를 관리하여 지연 시간(Latency)과 오류(Errors)를 제어하는 전략적 병목 관리**다.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://docs.aws.amazon.com/wellarchitected/latest/performance-efficiency-pillar/welcome.html">AWS Well-Architected Framework</a>
</div>

<br>

다음 글에서는 HTTP 요청 하나가 서버에 도달하기까지 통과하는 7개의 문, **OSI 7계층**을 따라간다. 각 계층이 대용량 트래픽 앞에서 어떻게 병목이 되는지, 그리고 엔지니어들이 어떤 선택을 해왔는지 살펴보겠다.
