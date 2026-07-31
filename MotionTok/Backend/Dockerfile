# ---- build stage: gradle 로 bootJar 생성 ----
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app

# 의존성 캐싱: 빌드 스크립트만 먼저 복사해 받아두면
# src 만 바뀌었을 때 의존성 다운로드를 건너뛴다.
COPY gradlew settings.gradle build.gradle ./
COPY gradle gradle
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon || true

COPY src src
RUN ./gradlew bootJar --no-daemon

# ---- run stage ----
# ⚠ 21-jre 가 아니라 21-jdk 다 (-153). 실측으로 확인한 사실 하나 때문에 바꿨다:
#    JRE 이미지에는 jcmd / jstack / jmap 이 <b>없다</b>.
#    그러면 앱이 멈췄을 때(스레드 고갈·데드락·GC 폭주) 원인을 볼 유일한 수단인 스레드 덤프를
#    뜰 수 없고, JFR 도 dumponexit(=죽은 뒤)에만 기댈 수밖에 없다. 재시도 기회가 없는
#    베타에서 "죽고 나서야 본다"는 선택지가 아니다.
#    jdk 로 바꾸면 운영 중에 언제든 아래를 쓸 수 있다:
#      docker exec motiontok-app jcmd 1 Thread.print              (스레드 덤프)
#      docker exec motiontok-app jcmd 1 JFR.dump filename=/logs/snap.jfr   (지금 시점 스냅샷)
#      docker exec motiontok-app jcmd 1 GC.heap_info
#    디스크 비용은 사실상 0 이다 — 위 build 스테이지가 이미 같은 21-jdk 이미지를 쓰므로
#    레이어가 그대로 공유된다(EC2 는 이 Dockerfile 로 직접 빌드한다).
FROM eclipse-temurin:21-jdk
WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar

# 관측 산출물이 떨어지는 곳(-153). 볼륨이 마운트되면 그 위에 덮이지만,
# 마운트를 빠뜨린 채 떠도 기동에 실패하지 않도록 이미지 안에 미리 만들어 둔다 —
# JFR 은 지정한 경로가 없으면 JVM 자체가 뜨지 않는다.
RUN mkdir -p /logs/jfr

EXPOSE 8080 9090

# JVM 옵션 (-153). 지금까지는 옵션이 하나도 없어 전부 기본값이었다.
#
#  MaxRAMPercentage=60
#    기본값은 컨테이너에 보이는 메모리의 25%. compose 에 mem_limit 이 없던 탓에 JVM 이
#    호스트 전체(15Gi)를 보고 힙을 약 3.7GB 로 잡고 있었다. mem_limit 을 걸면서 비율도
#    명시한다. 나머지 40%는 WebSocket 2000개가 쓰는 off-heap 다이렉트 버퍼 몫이다 —
#    이건 힙에 포함되지 않아 힙만 키우면 오히려 RSS 가 먼저 터진다.
#
#  HeapDumpOnOutOfMemoryError
#    OOM 이 나면 원인이 통째로 남는다. 기회가 한 번뿐인 베타에서 필수다.
#
#  StartFlightRecording (JFR)
#    "왜 느렸나"를 클래스 단위로 답하는 유일한 수단. 손으로 계측을 심으면 (a) 심은 곳만
#    보이고 (b) 어디를 심을지 미리 맞춰야 하는데, 우리에겐 재시도 기회가 없다.
#    오버헤드 약 2%. maxsize/maxage 로 디스크 상한을 건다.
#    dumponexit: 정상 종료(SIGTERM)면 녹화분이 파일로 떨어진다. 실측 0.8초, 5.3MB.
#    stackdepth=128: 기본 64는 스프링 스택에서 잘려 원인 클래스가 안 보인다.
#    ★ repository=/logs/jfr 가 핵심이다. JFR 은 녹화 중 조각(청크)을 임시 디렉터리에 쌓아 두다가
#      dump 시점에 하나로 합친다. 기본 임시 디렉터리는 <b>컨테이너 안의 /tmp</b> 라,
#      OOM 으로 SIGKILL 당하면(= dumponexit 이 돌 틈이 없다) 청크가 컨테이너와 함께 사라진다.
#      하필 그때가 가장 알고 싶은 순간이다. 호스트 볼륨으로 옮겨 두면 강제 종료돼도 청크가 남고
#      `jfr assemble /logs/jfr <out.jfr>` 로 복구할 수 있다.
#
#  file.encoding=UTF-8
#    로그에 한글(닉네임·채팅)이 들어간다. Java 18+ 기본이 UTF-8 이지만 명시해 둔다.
ENTRYPOINT ["java", \
  "-XX:MaxRAMPercentage=60.0", \
  "-XX:+HeapDumpOnOutOfMemoryError", \
  "-XX:HeapDumpPath=/logs/", \
  "-XX:StartFlightRecording=name=beta,maxsize=2g,maxage=6h,settings=profile,dumponexit=true,filename=/logs/beta.jfr", \
  "-XX:FlightRecorderOptions=stackdepth=128,repository=/logs/jfr", \
  "-Dfile.encoding=UTF-8", \
  "-jar", "/app/app.jar"]
