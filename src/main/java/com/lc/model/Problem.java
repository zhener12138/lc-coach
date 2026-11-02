package com.lc.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

/**
 * 一道题：力扣元信息 + 至少三种解法。
 *
 * ignoreUnknown = true 不是可选项：内容管线 content-src/build.js 会往 JSON 里
 * 额外写 javaTemplate 等字段，之前没加注解时 114 个文件在启动阶段解析失败、
 * 整库只剩 6 道题——加题时多一个字段就静默丢题，这类故障必须在模型层挡住。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class Problem {
    public String slug;
    public String frontendId;
    public String titleEn;
    public String titleCn;
    public String difficulty;
    public String tags;
    public String contentHtml;
    public String contentCnHtml;
    public String javaTemplate;
    public List<Solution> solutions;

    public String displayTitle() {
        return (titleCn != null && !titleCn.isBlank()) ? titleCn : titleEn;
    }
}
