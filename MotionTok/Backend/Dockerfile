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

# ---- run stage: JRE 만 담아 이미지 경량화 ----
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
