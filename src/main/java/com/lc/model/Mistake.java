package com.lc.model;

/** 错题记录 */
public class Mistake {
    public long id;
    public String problemSlug;
    public String problemTitle;
    public String whereStuck;   // 卡在哪
    public String oneLiner;     // 一句话结论
    public String tag;
    public String createdAt;
    public int reviewCount;     // 已复盘次数
    public String lastReviewedAt;
    public boolean mastered;    // 是否已掌握

    public Mistake() {}
}
