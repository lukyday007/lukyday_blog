---
title: 프롤로그 - 대용량 처리(Large-scale Processing)란 무엇인가?
description: 대용량 처리의 본질, 4가지 황금 신호(Golden Signals), 그리고 제약이론(TOC)의 결합
sidebar:
  order: 1
---

<br>

대용량 처리는 단순히 "사용자가 많다"는 현상을 넘어선 엔지니어링의 영역이다. 시스템이 가용 가능한 자원(CPU, Memory, Network Bandwidth)의 임계점에 도달했을 때, 성능 저하 없이 요청을 완수하고 서비스의 가용성을 보장하기 위한 기술적 전략을 의미한다.

<br>

### 1. 시스템의 상태를 결정짓는 4가지 황금 신호 (Golden Signals)

Google SRE팀은 시스템의 건강 상태를 평가하기 위해 반드시 측정해야 할 4가지 핵심 신호를 제시한다. 우리는 이 신호들을 통해 시스템의 병목과 한계를 감지한다.

<div style="text-align: right; margin-top: -1.0rem;">  
    <a href="https://sre.google/sre-book/monitoring-distributed-systems/">Google SRE: Monitoring Distributed Systems</a>
</div>

* **지연 시간 (Latency):** 요청을 처리하는 데 걸리는 시간. 성공/실패 여부에 따른 속도 차이를 추적하여 시스템 이상 징후를 파악한다.
* **트래픽 (Traffic):** 시스템에 가해지는 수요의 양. 초당 HTTP 요청 수(RPS) 등으로 측정한다.
* **오류 (Errors):** 명시적 혹은 암시적으로 실패한 요청의 비율이다.
* **포화도 (Saturation):** 시스템의 자원이 얼마나 "꽉 찼는지"를 나타낸다. 대용량 처리의 가장 직접적인 지표이며, 지연 시간의 증가는 종종 포화도의 전조 현상으로 나타난다.



<br>

### 2. 대용량 시스템을 정의하는 3가지 축과 세부 지표

황금 신호가 시스템의 '상태'를 보여준다면, 엔지니어는 구체적인 지표를 통해 부하의 '성격'을 정의하고 관리해야 한다.

**트래픽 (Traffic: 요청의 빈도와 수용량)**
단위 시간당 얼마나 많은 요청이 들어오는가, 그리고 얼마나 많은 연결을 유지할 수 있는가를 측정한다.
* **TPS / QPS:** 초당 처리되는 트랜잭션 또는 쿼리 수. 시스템의 실질적인 생산성을 나타낸다.
* **Concurrency:** 동일 시점에 유지되는 연결(Connection) 수. 티켓팅이나 이벤트 상황에서 시스템의 수용량을 결정짓는 핵심 요소다.

**데이터 양 (Volume: 데이터의 크기와 흐름)**
시스템이 처리해야 할 데이터의 물리적 크기와 전송 능력을 의미한다.
* **Throughput:** 단위 시간당 전송되는 데이터 크기(MB/s). 대용량 파일 전송이나 미디어 스트리밍 환경에서 시스템의 병목을 결정짓는다.

**복잡도 (Complexity: 처리의 난이도)**
요청 하나를 처리하기 위해 필요한 연산량과 시스템 간 상호작용의 수준이다.
* **Logic Latency:** 로직이 복잡해질수록 응답 시간이 길어지며, 이는 곧 포화도(Saturation)의 급격한 상승으로 이어진다.

<br>

### 3. 경영학 관점: 제약이론(Theory of Constraints, TOC)

엘리야후 골드랫(Eliyahu M. Goldratt)이 제시한 경영 관리 패러다임이다. "시스템의 전체 산출물은 가장 취약한 사슬, 즉 <strong>제약 요인(Constraint)</strong>에 의해 결정된다"는 것이 핵심이다.

<div style="text-align: right; margin-top: -1.0rem;">
  <a href="https://www.lean.org/lexicon-terms/theory-of-constraints/">Lean Enterprise Institute: TOC</a>
</div>

엔지니어링에서 **포화도(Saturation)**가 100%에 근접하는 지점이 바로 TOC에서 말하는 **병목(Bottleneck)**이다. 트래픽이 늘어날 때 어느 지점의 포화도가 가장 먼저 치솟는지 파악하고, 그 제약 요인을 적절한 전략으로 해소하는 것이 대용량 처리의 정수다.

<br>

### 4. 엔지니어링 전략: 확장성(Scalability)

TOC로 발견한 병목을 해결하기 위해 우리는 시스템의 수용량을 늘리는 확장성 전략을 사용한다.

<div style="text-align: right; margin-top: -1.0rem;">
  <a href="https://www.geeksforgeeks.org/overview-of-scaling-vertical-and-horizontal-scaling/">GeeksforGeeks: Vertical and Horizontal Scaling</a>
</div>

* **수직적 확장 (Scale-up):** 단일 노드의 CPU, RAM 등 사양을 높여 해당 지점의 포화도를 낮춘다.
* **수평적 확장 (Scale-out):** 노드의 개수를 늘려 부하를 분산하고 전체 시스템의 처리량(Throughput)을 늘린다.



<br>

### 5. 정리하며

대용량 처리는 **포화도(Saturation)를 관리하여 지연 시간(Latency)과 오류(Errors)를 제어하는 전략적 병목 관리**다.

<div style="text-align: right; margin-top: -1.0rem;">
  <a href="https://docs.aws.amazon.com/wellarchitected/latest/performance-efficiency-pillar/welcome.html">AWS Well-Architected Framework</a>
</div>

앞으로의 게시글을 통해 네트워크 계층부터 애플리케이션 아키텍처까지, 각 단계에서 발생하는 제약 요인을 지표로 확인하고 이를 어떻게 해결할지 다룰 예정이다.