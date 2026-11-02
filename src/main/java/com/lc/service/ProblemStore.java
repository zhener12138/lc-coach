package com.lc.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lc.model.Problem;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.io.File;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 题目内容库：从 content/problems/*.json 读取。
 * 内容与代码分离，加题只需丢一个 JSON 进来，不用改 Java。
 */
@Service
public class ProblemStore {

    private final Map<String, Problem> bySlug = new LinkedHashMap<>();
    private final ObjectMapper om = new ObjectMapper();
    private Path dir;

    @PostConstruct
    public void load() {
        dir = Paths.get("content", "problems");
        reload();
    }

    public synchronized int reload() {
        bySlug.clear();
        if (!Files.isDirectory(dir)) return 0;
        List<Path> files;
        try (var stream = Files.list(dir)) {
            files = stream.filter(p -> p.toString().endsWith(".json")).sorted().collect(Collectors.toList());
        } catch (Exception e) {
            return 0;
        }
        for (Path f : files) {
            try {
                Problem p = om.readValue(f.toFile(), Problem.class);
                if (p.slug == null || p.slug.isBlank()) continue;
                if (p.solutions == null) p.solutions = new ArrayList<>();
                p.solutions.sort(Comparator.comparingInt(s -> s.sortOrder));
                bySlug.put(p.slug, p);
            } catch (Exception e) {
                System.err.println("[ProblemStore] 解析失败 " + f.getFileName() + " : " + e.getMessage());
            }
        }
        return bySlug.size();
    }

    public Problem get(String slug) {
        return bySlug.get(slug);
    }

    public boolean has(String slug) {
        return bySlug.containsKey(slug);
    }

    /**
     * 按题名反查 slug。
     * 手记错题时 slug 是选填的，用户往往只写题名（还可能带「1. 」「[1]」这类题号前缀），
     * 于是库里留下一条 problem_slug 为空的错题，前端连「看题」按钮都画不出来。
     * 这里把题名归一化后跟 titleCn / titleEn / slug 三个字段依次比，命中就返回。
     */
    public String resolveSlugByTitle(String rawTitle) {
        String t = normalizeTitle(rawTitle);
        if (t.isEmpty()) return null;
        for (Problem p : bySlug.values()) {
            if (t.equals(normalizeTitle(p.titleCn))
                    || t.equals(normalizeTitle(p.titleEn))
                    || t.equals(normalizeTitle(p.slug))) {
                return p.slug;
            }
        }
        return null;
    }

    /** 去掉题号前缀 + 压空白 + 转小写，只用于比对，不用于展示 */
    private static String normalizeTitle(String s) {
        if (s == null) return "";
        String t = s.trim();
        // 「1. 两数之和」「[1] 两数之和」「1、两数之和」这类前缀都不影响匹配
        t = t.replaceFirst("^\\s*[\\[【(（]?\\s*\\d+\\s*[\\]】)）]?\\s*[.、:：]?\\s*", "");
        return t.replaceAll("\\s+", " ").trim().toLowerCase(java.util.Locale.ROOT);
    }

    public Collection<Problem> all() {
        return bySlug.values();
    }

    public int size() {
        return bySlug.size();
    }

    public Path dir() {
        return dir;
    }

    /** 保存一道题（写入 JSON 文件并重载） */
    public synchronized void save(Problem p) throws Exception {
        Files.createDirectories(dir);
        File f = dir.resolve(p.slug + ".json").toFile();
        om.writerWithDefaultPrettyPrinter().writeValue(f, p);
        reload();
    }
}
