# 📝 Lukyday Tech Blog Source Code

> **[ KR ]** 경영학의 트레이드오프 관점으로 다룬 백엔드 시스템 구조 및 성능 검증 기록입니다.  
> **[ EN ]** Documentation on backend architecture and performance validation through the lens of trade-offs.  
>  
> 🔗 **Live Site:** [lukyday-blog.vercel.app](https://lukyday-blog.vercel.app/)

---

## 📚 Article Tracks / 글 목록

### 📘 Track 1. CS Fundamentals

> **[ KR ]** 경영학적 트레이드오프 관점으로 접근한 CS 기초 이론 정리입니다.  
> **[ EN ]** Computer science core fundamentals analyzed through business trade-off perspectives.

- **운영체제 시리즈 (3편)** / **Operating System Series (3 parts)**
- **네트워크 시리즈 (5편)** / **Network Series (5 parts)**
- **데이터베이스 시리즈 (6편)** / **Database Series (6 parts)**

<br>

### ⚙️ Track 2. Problem Solving — Minichat Trade-offs

> **[ KR ]** 문제 원인 분석과 구조적 기술 선택의 근거를 정리한 기록입니다.  
> **[ EN ]** Architectural decisions and technical trade-offs behind backend problem-solving.

| 한국어 (KR) | English (EN) |
| :--- | :--- |
| [분산 락 대신 Lua Script를 선택한 이유](https://lukyday-blog.vercel.app/problem-solving/minichat/01-distributed-lock-vs-lua-script/) | [Choosing Lua Script Over Distributed Lock](https://lukyday-blog.vercel.app/en/problem-solving/minichat/01-distributed-lock-vs-lua-script/) |
| [Kafka 순서를 보장할 때와 포기할 때](https://lukyday-blog.vercel.app/problem-solving/minichat/02-kafka-message-ordering/) | [When Kafka Ordering Matters and When It Doesn't](https://lukyday-blog.vercel.app/en/problem-solving/minichat/02-kafka-message-ordering/) |
| [복제 지연 상황에서 읽기 전략을 선택하는 기준](https://lukyday-blog.vercel.app/problem-solving/minichat/03-read-write-replication-lag/) | [Choosing a Read Strategy Under Replication Lag](https://lukyday-blog.vercel.app/en/problem-solving/minichat/03-read-write-replication-lag/) |
| [같은 Redis 장애에 다른 대응을 선택한 이유](https://lukyday-blog.vercel.app/problem-solving/minichat/04-redis-rate-limiter/) | [Why the Same Redis Failure Needs Different Responses](https://lukyday-blog.vercel.app/en/problem-solving/minichat/04-redis-rate-limiter/) |
| [분산 환경에서 ID 전략](https://lukyday-blog.vercel.app/problem-solving/minichat/05-id-strategy-in-distributed-system/) | [Choosing an ID Strategy for Distributed Systems](https://lukyday-blog.vercel.app/en/problem-solving/minichat/05-id-strategy-in-distributed-system/) |
| [WebSocket에서 브로드캐스트를 포기한 이유](https://lukyday-blog.vercel.app/problem-solving/minichat/06-websocket-scale-out-grpc/) | [Choosing Target Routing Over Broadcast](https://lukyday-blog.vercel.app/en/problem-solving/minichat/06-websocket-scale-out-grpc/) |
| [유저 단위보다 서버 단위를 선택한 이유](https://lukyday-blog.vercel.app/problem-solving/minichat/07-parallel-wasnt-enough/) | [Choosing Server-Level Bulk Relay Over Per-User Processing](https://lukyday-blog.vercel.app/en/problem-solving/minichat/07-parallel-wasnt-enough/) |

<br>

### 🧪 Track 3. System Validation — Minichat Load & Fault Experiments

> **[ KR ]** k6 부하·장애 주입 테스트 및 모니터링 관측 기록입니다.  
> **[ EN ]** Load testing, fault injection experiments, and observability records using k6.

| 한국어 (KR) | English (EN) |
| :--- | :--- |
| [풀 크기를 늘렸다면 해결됐을까?](https://lukyday-blog.vercel.app/validation-experiments/minichat/connection-pool-contention/) | [Would a Larger Connection Pool Have Solved It?](https://lukyday-blog.vercel.app/en/validation-experiments/minichat/connection-pool-contention/) |
| [gRPC 단건 릴레이는 정말 느렸을까?](https://lukyday-blog.vercel.app/validation-experiments/minichat/grpc-single-bulk-relay/) | [Was Single gRPC Relay Really That Slow?](https://lukyday-blog.vercel.app/en/validation-experiments/minichat/grpc-single-bulk-relay/) |

---

## 🛠️ Local Development / 로컬 개발 환경

```bash
# Install dependencies / 의존성 설치
npm install

# Start local dev server (localhost:4321) / 로컬 개발 서버 실행
npm run dev

# Build for production / 프로덕션 빌드
npm run build
