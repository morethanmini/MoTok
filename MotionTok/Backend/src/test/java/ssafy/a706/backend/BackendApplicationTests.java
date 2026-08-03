package ssafy.a706.backend;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

@SpringBootTest
@TestPropertySource(properties = "app.shop.ai-provider=GPU")
class BackendApplicationTests {

    @Test
    void contextLoads() {
    }

}
