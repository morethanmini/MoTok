package ssafy.a706.backend.shop.service.ai;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Base64;
import java.util.Deque;

/**
 * fal 결과를 GPU 워커와 같은 모양으로 다듬는다 — 흰 배경 제거 + 정사각 중앙 배치.
 *
 * <p><b>왜 필요한가.</b> 프롬프트가 "plain white background"로 끝나서 모델은 일부러 흰 배경을
 * 그린다. GPU 워커 노트북은 그걸 {@code rembg}로 떼고 {@code _normalize}로 512 정사각에
 * 앉힌다. 이 단계가 없으면 fal로 만든 스티커만 <b>흰 사각형 덩어리</b>로 카메라에 붙어,
 * 같은 기능인데 어느 날은 이상하게 나오는 것처럼 보인다.</p>
 *
 * <p><b>왜 세그멘테이션이 아니라 가장자리 채우기인가.</b> rembg는 모델이라 서버에 얹기 무겁고,
 * fal의 배경제거 엔드포인트를 한 번 더 부르면 장당 크레딧이 두 배가 된다(예산이 3만원이다).
 * 대신 "흰 배경 위 단일 물체"라는 전제를 이용한다 — <b>테두리에서 시작해 흰색을 타고 번지는
 * 영역만</b> 지우므로 그림 안쪽의 흰색(눈동자 하이라이트 등)은 살아남는다. 전체를 흰색 기준으로
 * 한 번에 지우면 그 안쪽까지 구멍이 뚫린다.</p>
 */
@Slf4j
@Component
public class AiItemImagePostProcessor {

    /** 워커 {@code _normalize(size=512, margin=0.08)}와 같은 값 — 두 경로의 결과 크기를 맞춘다. */
    private static final int CANVAS_SIZE = 512;
    private static final double MARGIN_RATIO = 0.08;

    /** 이 값 이상이면 흰색으로 본다(0~255). 낮출수록 더 과감히 지운다. */
    @Value("${app.shop.fal.background-threshold}")
    private int whiteThreshold;

    /**
     * @param imageBase64 fal이 준 PNG base64(접두사 없음)
     * @return 배경이 지워지고 512 정사각 중앙에 놓인 PNG base64
     * @throws FalGenerationException 이미지를 읽거나 쓸 수 없을 때
     */
    public String toTransparentItem(String imageBase64) {
        byte[] bytes = Base64.getDecoder().decode(imageBase64);
        BufferedImage source;
        try {
            source = ImageIO.read(new ByteArrayInputStream(bytes));
        } catch (IOException e) {
            throw new FalGenerationException("생성 결과 이미지를 읽지 못했습니다", e);
        }
        if (source == null) {
            throw new FalGenerationException("생성 결과가 이미지 형식이 아닙니다");
        }

        BufferedImage cut = removeOuterWhite(toArgb(source));
        BufferedImage item = normalize(cut);
        return Base64.getEncoder().encodeToString(encodePng(item));
    }

    private BufferedImage toArgb(BufferedImage source) {
        if (source.getType() == BufferedImage.TYPE_INT_ARGB) {
            return source;
        }
        BufferedImage argb = new BufferedImage(
                source.getWidth(), source.getHeight(), BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = argb.createGraphics();
        g.drawImage(source, 0, 0, null);
        g.dispose();
        return argb;
    }

    /**
     * 테두리에서 흰색을 타고 이어진 영역만 투명하게 만든다.
     *
     * <p>재귀가 아니라 스택으로 도는 이유 — 1024x1024면 100만 픽셀이라 재귀로는 스택이 넘친다.</p>
     *
     * <p>다 지워질 것 같으면(예: 결과가 통째로 흰 이미지) 원본을 그대로 돌려준다.
     * 빈 그림을 저장하느니 배경이 남은 그림이 낫다 — 유저가 무엇이 잘못됐는지 볼 수 있다.</p>
     */
    private BufferedImage removeOuterWhite(BufferedImage image) {
        int w = image.getWidth();
        int h = image.getHeight();
        boolean[] background = new boolean[w * h];
        Deque<Integer> stack = new ArrayDeque<>();

        for (int x = 0; x < w; x++) {
            pushIfWhite(image, background, stack, x, 0, w);
            pushIfWhite(image, background, stack, x, h - 1, w);
        }
        for (int y = 0; y < h; y++) {
            pushIfWhite(image, background, stack, 0, y, w);
            pushIfWhite(image, background, stack, w - 1, y, w);
        }

        int removed = 0;
        while (!stack.isEmpty()) {
            int index = stack.pop();
            int x = index % w;
            int y = index / w;
            removed++;
            pushIfWhite(image, background, stack, x - 1, y, w);
            pushIfWhite(image, background, stack, x + 1, y, w);
            pushIfWhite(image, background, stack, x, y - 1, w);
            pushIfWhite(image, background, stack, x, y + 1, w);
        }

        // 거의 전부가 배경으로 판정됐다 — 흰 그림이거나 임계값이 과하다. 지우지 않는다.
        if (removed >= (long) w * h * 0.98) {
            log.warn("생성 결과가 거의 전부 흰색이라 배경 제거를 건너뜁니다(임계값 {})", whiteThreshold);
            return image;
        }

        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                out.setRGB(x, y, background[y * w + x] ? 0 : image.getRGB(x, y));
            }
        }
        return out;
    }

    private void pushIfWhite(BufferedImage image, boolean[] background, Deque<Integer> stack,
                             int x, int y, int w) {
        if (x < 0 || y < 0 || x >= w || y >= image.getHeight()) {
            return;
        }
        int index = y * w + x;
        if (background[index] || !isWhite(image.getRGB(x, y))) {
            return;
        }
        background[index] = true;
        stack.push(index);
    }

    /** 이미 투명한 픽셀도 배경으로 친다 — fal이 투명 배경을 줬을 때도 같은 경로로 흐른다. */
    private boolean isWhite(int argb) {
        int alpha = (argb >>> 24) & 0xFF;
        if (alpha < 16) {
            return true;
        }
        int r = (argb >> 16) & 0xFF;
        int g = (argb >> 8) & 0xFF;
        int b = argb & 0xFF;
        return r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold;
    }

    /** 워커 {@code _normalize}와 같은 규칙 — 알파 경계로 잘라 비율 유지 축소 후 정사각 중앙에 둔다. */
    private BufferedImage normalize(BufferedImage image) {
        int[] box = alphaBounds(image);
        BufferedImage cropped = box == null
                ? image
                : image.getSubimage(box[0], box[1], box[2] - box[0] + 1, box[3] - box[1] + 1);

        int inner = (int) (CANVAS_SIZE * (1 - MARGIN_RATIO * 2));
        double ratio = Math.min(
                inner / (double) cropped.getWidth(), inner / (double) cropped.getHeight());
        int width = Math.max(1, (int) Math.round(cropped.getWidth() * ratio));
        int height = Math.max(1, (int) Math.round(cropped.getHeight() * ratio));

        BufferedImage canvas = new BufferedImage(CANVAS_SIZE, CANVAS_SIZE, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = canvas.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.drawImage(cropped, (CANVAS_SIZE - width) / 2, (CANVAS_SIZE - height) / 2, width, height, null);
        g.dispose();
        return canvas;
    }

    /** 불투명한 픽셀이 차지하는 최소 사각형 {minX, minY, maxX, maxY}. 전부 투명이면 null. */
    private int[] alphaBounds(BufferedImage image) {
        int minX = Integer.MAX_VALUE;
        int minY = Integer.MAX_VALUE;
        int maxX = -1;
        int maxY = -1;
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                if (((image.getRGB(x, y) >>> 24) & 0xFF) == 0) {
                    continue;
                }
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
        return maxX < 0 ? null : new int[] {minX, minY, maxX, maxY};
    }

    private byte[] encodePng(BufferedImage image) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            ImageIO.write(image, "png", out);
        } catch (IOException e) {
            throw new FalGenerationException("생성 결과를 PNG로 쓰지 못했습니다", e);
        }
        return out.toByteArray();
    }
}
