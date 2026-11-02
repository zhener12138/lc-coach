package com.lc;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

@SpringBootApplication
@EnableScheduling
public class App {
    public static void main(String[] args) {
        ensureTempDir();
        SpringApplication.run(App.class, args);
    }

    /**
     * 启动前先确认 java.io.tmpdir 真的能建目录，不能就换一个。
     *
     * 为什么必须在 run() 之前做：Spring Boot 自己启动时就要在 tmpdir 下建
     * 临时目录（Tomcat 的 baseDir）。那个目录不可写的话，异常是
     * 「Unable to create tempDir. java.io.tmpdir is set to ...」，
     * 整个服务起不来 —— 不是某个功能坏了，是整个项目打不开。
     *
     * 为什么会不可写：受限沙箱、只读挂载的 /tmp、被杀毒软件锁住、
     * 或者目录本身存在但 ACL 不允许建子目录（目录存在 != 可写，
     * 这是最容易误判的一点）。
     */
    private static void ensureTempDir() {
        String current = System.getProperty("java.io.tmpdir");
        if (current != null && canCreateIn(Path.of(current))) return;

        List<Path> candidates = new ArrayList<>();
        candidates.add(Path.of(".jtmp"));                       // 项目目录下，最稳
        candidates.add(Path.of("data", "tmp"));
        String home = System.getProperty("user.home");
        if (home != null && !home.isBlank()) {
            candidates.add(Path.of(home, ".lc-coach", "tmp"));
        }

        for (Path base : candidates) {
            if (!canCreateIn(base)) continue;
            Path abs = base.toAbsolutePath().normalize();
            System.setProperty("java.io.tmpdir", abs.toString());
            // Tomcat 走的是自己的 basedir，光改 java.io.tmpdir 不够
            System.setProperty("server.tomcat.basedir", abs.toString());
            log("临时目录不可用（" + current + "），已改用 " + abs);
            return;
        }
        log("警告：找不到可写的临时目录，编译评分和 Tomcat 启动可能失败。检查项目目录写权限。");
    }

    /** 真的建一个目录再删掉 —— 「目录存在」和「能建子目录」是两件事。 */
    private static boolean canCreateIn(Path base) {
        try {
            Files.createDirectories(base);
            Path probe = Files.createTempDirectory(base, "probe");
            Files.deleteIfExists(probe);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** 在源头定死 UTF-8，不靠 -Dfile.encoding（那个管不到控制台）。 */
    private static void log(String msg) {
        try {
            System.out.write((msg + System.lineSeparator())
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8));
            System.out.flush();
        } catch (Exception ignored) {
        }
    }
}
