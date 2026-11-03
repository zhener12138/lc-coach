package com.lc.service;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

/**
 * 数据库自动备份。
 *
 * 为什么要有这个：曾经因为一次清理操作把 data/lccoach.mv.db 删了，
 * 打卡记录、错题本、力扣绑定全没了，而且**没有任何备份可以恢复**。
 * 一个存着个人学习数据的工具没有备份，是设计缺陷，不是运维疏忽。
 *
 * 三条设计决定：
 *
 * 1. 用 H2 自己的 BACKUP TO，不直接拷 .mv.db 文件。
 *    直接拷文件时数据库可能正在写，拷出来的是撕裂的；BACKUP TO 是
 *    一致性快照（H2 内部会等写事务收尾），恢复时用 RunScript 或
 *    把它整个还原成库文件。
 *
 * 2. 启动时 + 每 6 小时各备份一次。
 *    只在启动时备份不够——服务开着跑一整天，中途的数据同样会丢。
 *
 * 3. 保留最近 7 份，多了删最旧的。
 *    不设上限的话，一年后是几百个文件，而且没人会去清理。
 */
@Service
public class BackupService {

    private static final int KEEP = 7;
    private static final DateTimeFormatter STAMP =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");

    private final DataSource ds;

    public BackupService(DataSource ds) {
        this.ds = ds;
    }

    /** 启动后立刻备份一份。这时候库最干净，也最能反映「启动那一刻的状态」。 */
    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        backup("startup");
    }

    /** 每 6 小时一次，防止服务长期运行期间的数据无人看管。 */
    @Scheduled(fixedDelay = 6L * 60 * 60 * 1000, initialDelay = 6L * 60 * 60 * 1000)
    public void periodic() {
        backup("periodic");
    }

    /**
     * 备份一次。失败只记日志，不抛异常 ——
     * 备份坏了是少一层保险，让业务因此挂掉是本末倒置。
     */
    public void backup(String reason) {
        try {
            Path dir = Path.of("data", "backup");
            Files.createDirectories(dir);
            String name = "lccoach-" + LocalDateTime.now().format(STAMP)
                    + "-" + reason + ".zip";
            Path target = dir.resolve(name).toAbsolutePath();

            try (java.sql.Connection c = ds.getConnection();
                 java.sql.Statement s = c.createStatement()) {
                // H2 的 BACKUP TO 要的是 SQL 字符串字面量，单引号需转义
                String sql = "BACKUP TO '" + target.toString().replace("'", "''") + "'";
                s.execute(sql);
            }

            prune(dir);
            log("数据库已备份：" + name);
        } catch (Exception e) {
            log("备份失败（不影响服务）：" + e.getMessage());
        }
    }

    /** 只保留最近 KEEP 份，按文件名里的时间戳排序（比 mtime 可靠）。 */
    private void prune(Path dir) throws IOException {
        List<Path> all = new ArrayList<>();
        try (Stream<Path> s = Files.list(dir)) {
            s.filter(p -> p.getFileName().toString().endsWith(".zip")).forEach(all::add);
        }
        if (all.size() <= KEEP) return;
        all.sort(Comparator.comparing(p -> p.getFileName().toString()));
        for (int i = 0; i < all.size() - KEEP; i++) {
            Files.deleteIfExists(all.get(i));
        }
    }

    /** 在源头定死 UTF-8，不靠 -Dfile.encoding（那个管不到控制台）。 */
    private static void log(String msg) {
        try {
            System.out.write((msg + System.lineSeparator())
                    .getBytes(StandardCharsets.UTF_8));
            System.out.flush();
        } catch (Exception ignored) {
        }
    }
}
