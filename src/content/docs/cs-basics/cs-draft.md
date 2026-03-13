---
title: CS 기초 핵심 요약
description: 대용량 처리를 이해하기 위해 반드시 알아야 할 CS 지식 정리
sidebar:
  order: 1
---

탄탄한 CS 기초는 복잡한 분산 시스템의 문제를 해결하는 근본적인 힘이 됩니다. 주요 과목별 핵심 키워드를 정리합니다.

---

## 1. 네트워크 (Network)
데이터가 서버와 클라이언트 사이를 어떻게 안전하고 빠르게 이동하는지 이해합니다.

* **핵심 키워드:** TCP/UDP, HTTP/HTTPS(1.1, 2.0, 3.0), DNS, OSI 7계층, TLS 핸드쉐이크, 로드 밸런싱(L4/L7).
* **대용량 관점:** "HTTP/2의 멀티플렉싱이 대용량 이미지 로딩 속도를 어떻게 개선하는가?"

---

## 2. 운영체제 (Operating System)
서버 자원(CPU, Memory)을 효율적으로 관리하는 법을 배웁니다.

* **핵심 키워드:** 프로세스 vs 스레드, 멀티스레딩, 컨텍스트 스위칭, 메모리 관리(Virtual Memory, Paging), 시스템 콜, I/O 모델(Blocking vs Non-Blocking).
* **대용량 관점:** "수만 개의 동시 접속을 처리하기 위해 왜 Non-Blocking I/O가 필요한가?"

---

## 3. 데이터베이스 (Database)
데이터를 안전하게 저장하고 빠르게 조회하는 전략을 다룹니다.

* **핵심 키워드:** 트랜잭션(ACID), 인덱스(B-Tree, Hash), 실행 계획, 조인(Join) 최적화, 정규화 vs 비정규화, 격리 수준(Isolation Level).
* **대용량 관점:** "인덱스가 없는 1,000만 건의 테이블에서 데이터를 조회할 때 발생하는 성능 저하 해결하기"

---

## 4. 자료구조 (Data Structure)
상황에 맞는 최적의 데이터 저장 방식을 선택합니다.

* **핵심 키워드:** Array vs List, Hash Map(O(1)의 마법), Stack/Queue, Tree(B-Tree, Trie), Graph.
* **대용량 관점:** "캐시 시스템(Redis)은 왜 내부적으로 Hash Table이나 Skip List를 사용하는가?"

---

## 5. 자바/스프링 (Java & Spring)
엔터프라이즈급 백엔드 시스템을 구축하는 도구입니다.

* **핵심 키워드:** JVM 구조(GC 최적화), 객체지향 5원칙(SOLID), DI/IoC, AOP, 스프링 빈(Bean) 스코프, JPA/Hibernate.
* **대용량 관점:** "JVM의 가비지 컬렉션(GC) 튜닝을 통해 서버의 응답 지연(Latency) 최소화하기"