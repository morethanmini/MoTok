<template>
  <div class="cat-stage" aria-hidden="true">
    <img src="/assets/auth/cat.png" alt="" />
  </div>
</template>

<style scoped>
.cat-stage {
  position: absolute;
  z-index: 0;
  top: 62px;
  right: -224px;
  width: 238px;
  aspect-ratio: 578 / 787;
  pointer-events: none;
}

.cat-stage img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

@media (max-width: 760px) {
  .cat-stage {
    top: -120px;
    right: -40px;
    transform: scale(.64);
    transform-origin: bottom right;
  }
}
</style>
