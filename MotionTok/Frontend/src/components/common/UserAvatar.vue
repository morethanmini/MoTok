<script setup lang="ts">
/**
 * 프로필 아바타 — 사진이 있으면 그리고, 없으면 이모지로 떨어진다.
 *
 * 크기·테두리·모양은 <b>부모가 class로 정한다</b>. 헤더(원형 43px)·마이페이지(사각 60px)·
 * 로비 친구 목록(사각 44px)이 모두 다른 모양이라, 여기서 크기를 받기 시작하면 화면마다
 * 프롭 조합이 갈라진다. 이 컴포넌트가 책임지는 건 "사진이냐 이모지냐"와 그 잘라내기뿐이다.
 *
 * @error 처리가 핵심이다 — 사진은 S3에 있고 우리 DB의 URL과 수명이 다르다(객체가 지워졌거나
 * 버킷 정책이 바뀌면 404). 그때 깨진 이미지 아이콘 대신 기본 아바타로 조용히 되돌린다.
 */
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 프로필 사진 URL. null·undefined면 fallback을 그린다. */
    src?: string | null
    /** 사진이 없거나 못 불러왔을 때 그릴 이모지 */
    fallback?: string
    alt?: string
  }>(),
  { src: null, fallback: '😎', alt: '' },
)

// 로드 실패 기록. src가 바뀌면(사진 교체) 다시 시도해야 하므로 초기화한다.
const failed = ref(false)
watch(
  () => props.src,
  () => {
    failed.value = false
  },
)
</script>

<template>
  <span class="user-avatar">
    <!--
      loading="lazy" — 친구 목록은 스크롤 영역이라 화면 밖 사진까지 미리 받을 이유가 없다.
      S3 요청 수를 줄이는 두 번째 장치(첫 번째는 서버가 심는 Cache-Control).
    -->
    <img
      v-if="src && !failed"
      :src="src"
      :alt="alt"
      loading="lazy"
      decoding="async"
      @error="failed = true"
    />
    <template v-else>{{ fallback }}</template>
  </span>
</template>

<style scoped>
.user-avatar {
  display: grid;
  place-items: center;
  /* 모양(border-radius)은 부모 class가 정하고, 사진은 그 모양대로 잘린다.
     여기서 border-radius를 건드리면 부모 규칙과 특이도가 같아 로드 순서에 따라
     원형 아바타가 사각형이 되는 식으로 뒤집힌다.
     부모 쪽에 overflow:hidden을 거는 방법은 쓰지 않는다 — 바깥에 붙는 배지
     (마이페이지 카메라 버튼)까지 함께 잘린다. */
  overflow: hidden;
}
.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
