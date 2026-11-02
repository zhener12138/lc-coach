package com.lc.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;

/**
 * 模板库的内置数据。
 *
 * 起因：52 段模板原来只存在数据库里，是当初用脚本 POST 进去的。
 * 结果别人 clone 下来一跑，模板库是空的 —— 模板库是明确的功能需求之一，
 * 靠「我记得先跑一遍 seed 脚本」来保证它存在，那不叫功能，叫运气。
 *
 * 两条规则：
 * 1. 只在表为空时灌。表里已经有东西就不动 —— 用户可能自己加过、删过，
 *    每次启动都补回来等于把他的编辑一遍遍抹掉。
 * 2. 数据放 content/snippets.json，和 problems 一样做成内容文件。
 *    内容归内容，代码归代码，加模板不用改 Java。
 */
@Service
public class SnippetStore {

    private final Db db;
    private final ObjectMapper om = new ObjectMapper();

    public SnippetStore(Db db) {
        this.db = db;
    }

    @PostConstruct
    public void seedIfEmpty() {
        try {
            int have = db.countSnippets();
            if (have > 0) return;   // 已经有数据，不碰

            Path f = Paths.get("content", "snippets.json");
            if (!Files.isRegularFile(f)) return;

            List<Map<String, Object>> items = om.readValue(
                    f.toFile(),
                    om.getTypeFactory().constructCollectionType(List.class, Map.class));
            if (items == null || items.isEmpty()) return;

            int n = 0;
            for (Map<String, Object> it : items) {
                Object cat = it.get("category");
                Object title = it.get("title");
                Object code = it.get("code");
                if (code == null || String.valueOf(code).isBlank()) continue;
                Object note = it.get("note");
                Object order = it.get("sortOrder");
                int so = order instanceof Number ? ((Number) order).intValue() : 0;
                db.addSnippet(
                        cat == null ? "" : String.valueOf(cat),
                        title == null ? "" : String.valueOf(title),
                        String.valueOf(code),
                        note == null ? "" : String.valueOf(note),
                        so);
                n++;
            }
            System.out.println("模板库为空，已从 content/snippets.json 灌入 " + n + " 段模板");
        } catch (Exception e) {
            // 灌数据失败不该拦住整个服务启动 —— 模板库空着顶多少一个功能，
            // 但服务起不来是整个项目不能用。差异太大，不能同归于尽。
            System.out.println("模板初始化失败（不影响启动）：" + e.getMessage());
        }
    }
}
