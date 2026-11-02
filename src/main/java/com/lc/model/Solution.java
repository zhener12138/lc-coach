package com.lc.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** 一种解法。tier 取值：brute(暴力) / better(较好) / optimal(最优) */
@JsonIgnoreProperties(ignoreUnknown = true)
public class Solution {
    public long id;
    public String problemSlug;
    public String tier;
    public String title;
    public String idea;
    public String pseudocode;
    public String codeJava;
    public String timeComplexity;
    public String spaceComplexity;
    public int sortOrder;

    public Solution() {}

    public Solution(String tier, String title, String idea, String pseudocode,
                    String codeJava, String time, String space, int order) {
        this.tier = tier;
        this.title = title;
        this.idea = idea;
        this.pseudocode = pseudocode;
        this.codeJava = codeJava;
        this.timeComplexity = time;
        this.spaceComplexity = space;
        this.sortOrder = order;
    }
}
