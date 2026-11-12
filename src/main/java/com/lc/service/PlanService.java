package com.lc.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.io.InputStream;
import java.nio.file.*;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * 16 周计划：读 plan.json，按开始日期算出"今天该做哪几道题"。
 * plan.json 优先从 content/plan.json 读（可改），不存在则用 jar 内置的默认计划。
 */
@Service
public class PlanService {

    private final ObjectMapper om = new ObjectMapper();
    private JsonNode root;
    private LocalDate startDate;

    @PostConstruct
    public void load() {
        try {
            Path ext = Paths.get("content", "plan.json");
            if (Files.exists(ext)) {
                root = om.readTree(ext.toFile());
            } else {
                try (InputStream is = getClass().getClassLoader().getResourceAsStream("plan.json")) {
                    root = om.readTree(is);
                }
                Files.createDirectories(Paths.get("content"));
                om.writerWithDefaultPrettyPrinter().writeValue(ext.toFile(), root);
            }
            startDate = LocalDate.parse(root.path("startDate").asText("2026-11-02"));
        } catch (Exception e) {
            throw new RuntimeException("加载计划失败: " + e.getMessage(), e);
        }
    }


    /** 今天是计划的第几天（1-based）。早于开始日返回 0 */
    public int todayDayNo() {
        long d = ChronoUnit.DAYS.between(startDate, LocalDate.now()) + 1;
        if (d < 1) return 0;
        return (int) Math.min(d, 112);
    }

    public int totalDays() { return 112; }

    private JsonNode findDay(int dayNo) {
        for (JsonNode w : root.get("weeks")) {
            for (JsonNode d : w.get("days")) {
                if (d.path("day").asInt() == dayNo) {
                    ((com.fasterxml.jackson.databind.node.ObjectNode) d)
                            .put("week", w.path("week").asInt());
                    ((com.fasterxml.jackson.databind.node.ObjectNode) d)
                            .put("phase", w.path("phase").asText());
                    ((com.fasterxml.jackson.databind.node.ObjectNode) d)
                            .put("tag", w.path("tag").asText());
                    return d;
                }
            }
        }
        return null;
    }

    /** 今日任务 */
    public Map<String, Object> today() {
        return dayAt(null);
    }

    /**
     * 第 dayNo 天的任务。dayNo 传 null 表示「今天」。
     *
     * 为什么不在前端算：前端不知道 startDate、不知道哪天是复盘日、
     * 更不知道题库里某道题有没有内容。让后端按 dayNo 返回同一份结构，
     * 前端只负责「显示哪天」，两边就不会各算一套、各错一处。
     *
     * 注意：翻到别的日子只影响「看什么」，不影响「今天打卡」——
     * 打卡永远记在真实今天，否则连续天数和进度会跟着跳。
     */
    public Map<String, Object> dayAt(Integer wantDay) {
        int realDay = todayDayNo();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("totalDays", totalDays());
        out.put("today", LocalDate.now().toString());
        out.put("startDate", startDate.toString());

        // 还没到开始日：预览第 1 天，别给用户一个空页面
        boolean preview = false;
        int dayNo;
        if (wantDay != null) {
            dayNo = Math.max(1, Math.min(totalDays(), wantDay));
        } else if (realDay == 0) {
            preview = true;
            dayNo = 1;
            out.put("daysToStart", -ChronoUnit.DAYS.between(startDate, LocalDate.now()));
        } else {
            dayNo = realDay;
        }
        // 翻到的这天是不是真实今天。计划还没开始时 realDay 是 0，
        // 此时第 1 天算「今天」——用户看到的就是今天的安排。
        boolean lookingAtToday = (realDay == 0 ? 1 : realDay) == dayNo;
        out.put("dayNo", dayNo);
        out.put("realDayNo", realDay);
        out.put("isToday", lookingAtToday);
        out.put("date", startDate.plusDays(dayNo - 1L).toString());
        out.put("hasPrev", dayNo > 1);
        out.put("hasNext", dayNo < totalDays());
        out.put("preview", preview);

        JsonNode d = findDay(dayNo);
        if (d == null) {
            out.put("phase", "已完成");
            out.put("tag", "-");
            out.put("slugs", List.of());
            return out;
        }

        List<String> slugs = new ArrayList<>();
        if (d.has("slugs")) for (JsonNode s : d.get("slugs")) slugs.add(s.asText());

        out.put("phase", d.path("phase").asText());
        out.put("tag", d.path("tag").asText());
        out.put("slugs", slugs);
        out.put("review", d.path("review").asBoolean(false));
        out.put("note", d.path("note").asText(""));
        return out;
    }

    /** 整个计划（用于日历视图） */
    public List<Map<String, Object>> fullPlan() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (JsonNode w : root.get("weeks")) {
            Map<String, Object> wm = new LinkedHashMap<>();
            wm.put("week", w.path("week").asInt());
            wm.put("phase", w.path("phase").asText());
            wm.put("tag", w.path("tag").asText());
            List<Map<String, Object>> days = new ArrayList<>();
            for (JsonNode d : w.get("days")) {
                Map<String, Object> dm = new LinkedHashMap<>();
                dm.put("day", d.path("day").asInt());
                dm.put("date", startDate.plusDays(d.path("day").asInt() - 1L).toString());
                List<String> slugs = new ArrayList<>();
                if (d.has("slugs")) for (JsonNode s : d.get("slugs")) slugs.add(s.asText());
                dm.put("slugs", slugs);
                dm.put("review", d.path("review").asBoolean(false));
                dm.put("note", d.path("note").asText(""));
                days.add(dm);
            }
            wm.put("days", days);
            out.add(wm);
        }
        return out;
    }
}
