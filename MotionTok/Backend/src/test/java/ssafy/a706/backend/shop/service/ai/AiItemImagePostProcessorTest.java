package ssafy.a706.backend.shop.service.ai;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * fal 결과 후처리 — 흰 배경 제거 + 512 정사각 중앙 배치.
 *
 * <p>여기서 못박는 핵심은 <b>안쪽 흰색이 안 뚫린다</b>는 것이다. 흰색을 전부 지우는 방식으로
 * 바꾸면 눈동자 하이라이트 같은 밝은 부분에 구멍이 난다 — 화면에서는 "그림이 깨졌다"로 보이고,
 * 배경이 잘 지워진 것만 보고 넘기면 놓치기 쉽다.</p>
 */
class AiItemImagePostProcessorTest {

    private static final int SIZE = 512;

    private AiItemImagePostProcessor processor;

    @BeforeEach
    void setUp() {
        processor = new AiItemImagePostProcessor();
        ReflectionTestUtils.setField(processor, "whiteThreshold", 240);
    }

    private String encode(BufferedImage image) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            ImageIO.write(image, "png", out);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        return Base64.getEncoder().encodeToString(out.toByteArray());
    }

    private BufferedImage decode(String base64) {
        try {
            return ImageIO.read(new ByteArrayInputStream(Base64.getDecoder().decode(base64)));
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** 흰 배경 위에 색 도형 하나. 도형 안에 흰 점을 찍어 "안쪽 흰색"을 만든다. */
    private BufferedImage sketchOnWhite(boolean withInnerWhite) {
        BufferedImage image = new BufferedImage(200, 200, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, 200, 200);
        g.setColor(new Color(40, 90, 200));
        g.fillOval(50, 50, 100, 100);
        if (withInnerWhite) {
            g.setColor(Color.WHITE);
            g.fillOval(90, 85, 16, 16); // 눈동자 하이라이트 같은 안쪽 흰색
        }
        g.dispose();
        return image;
    }

    private int alphaAt(BufferedImage image, int x, int y) {
        return (image.getRGB(x, y) >>> 24) & 0xFF;
    }

    @Test
    @DisplayName("바깥 흰 배경은 투명해진다")
    void removesOuterWhite() {
        BufferedImage result = decode(processor.toTransparentItem(encode(sketchOnWhite(false))));

        assertThat(alphaAt(result, 2, 2)).isZero();
        assertThat(alphaAt(result, SIZE - 3, SIZE - 3)).isZero();
    }

    @Test
    @DisplayName("그림 안쪽 흰색은 남는다 — 흰색을 통째로 지우면 하이라이트에 구멍이 난다")
    void keepsInnerWhite() {
        BufferedImage result = decode(processor.toTransparentItem(encode(sketchOnWhite(true))));

        // 도형이 여백 8%를 두고 정중앙에 놓이므로 가운데는 그림이다
        assertThat(alphaAt(result, SIZE / 2, SIZE / 2)).isEqualTo(255);
        // 안쪽 흰 점이 있던 자리도 뚫리지 않았다(불투명 픽셀이 여전히 대부분)
        long opaque = 0;
        for (int y = SIZE / 2 - 40; y < SIZE / 2 + 40; y++) {
            for (int x = SIZE / 2 - 40; x < SIZE / 2 + 40; x++) {
                if (alphaAt(result, x, y) > 0) {
                    opaque++;
                }
            }
        }
        assertThat(opaque).isEqualTo(80L * 80L);
    }

    @Test
    @DisplayName("결과는 512 정사각이고 그림이 가운데에 온다 — 워커 _normalize와 같은 규격")
    void normalizesToCenteredSquare() {
        // 한쪽 구석에 치우친 작은 도형
        BufferedImage image = new BufferedImage(400, 200, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, 400, 200);
        g.setColor(Color.RED);
        g.fillRect(10, 10, 40, 40);
        g.dispose();

        BufferedImage result = decode(processor.toTransparentItem(encode(image)));

        assertThat(result.getWidth()).isEqualTo(SIZE);
        assertThat(result.getHeight()).isEqualTo(SIZE);
        assertThat(alphaAt(result, SIZE / 2, SIZE / 2)).isEqualTo(255);
        // 여백(8%) 안쪽은 비어 있어야 한다
        assertThat(alphaAt(result, 5, 5)).isZero();
    }

    @Test
    @DisplayName("이미 투명 배경이면 그대로 다듬기만 한다")
    void handlesAlreadyTransparent() {
        BufferedImage image = new BufferedImage(200, 200, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        g.setColor(new Color(20, 160, 90));
        g.fillOval(60, 60, 80, 80);
        g.dispose();

        BufferedImage result = decode(processor.toTransparentItem(encode(image)));

        assertThat(result.getWidth()).isEqualTo(SIZE);
        assertThat(alphaAt(result, SIZE / 2, SIZE / 2)).isEqualTo(255);
        assertThat(alphaAt(result, 2, 2)).isZero();
    }

    @Test
    @DisplayName("통째로 흰 결과는 지우지 않는다 — 빈 그림보다 잘못된 그림이 낫다")
    void keepsAllWhiteImage() {
        BufferedImage image = new BufferedImage(100, 100, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, 100, 100);
        g.dispose();

        BufferedImage result = decode(processor.toTransparentItem(encode(image)));

        // 다 지웠으면 알파 경계가 없어 빈 캔버스가 나온다 — 그러지 않고 흰 그림이 남아야 한다
        assertThat(alphaAt(result, SIZE / 2, SIZE / 2)).isEqualTo(255);
    }

    @Test
    @DisplayName("이미지가 아닌 데이터는 실패로 알린다 — 조용히 저장되면 안 된다")
    void rejectsNonImage() {
        String garbage = Base64.getEncoder().encodeToString("not an image".getBytes());

        assertThatThrownBy(() -> processor.toTransparentItem(garbage))
                .isInstanceOf(FalGenerationException.class);
    }
}
