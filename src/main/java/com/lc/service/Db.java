package com.lc.service;

import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.sql.*;
import java.util.*;

/**
 * 用 JDBC + H2 直接管数据，不引 ORM —— 依赖少、启动快、SQL 透明。
 */
@Service
public class Db {

    private final String url = "jdbc:h2:file:./data/lccoach;MODE=MySQL;AUTO_SERVER=TRUE";
    private final String user = "sa";
    private final String pass = "";

    public Connection conn() throws SQLException {
        return DriverManager.getConnection(url, user, pass);
    }

    @PostConstruct
    public void init() {
        String[] ddl = {
            "CREATE TABLE IF NOT EXISTS setting(k VARCHAR(64) PRIMARY KEY, v CLOB)",
            "CREATE TABLE IF NOT EXISTS plan_day(" +
                "  id BIGINT AUTO_INCREMENT PRIMARY KEY," +
                "  day_no INT NOT NULL," +
                "  plan_date DATE," +
                "  week INT," +
                "  tag VARCHAR(64)," +
                "  slugs VARCHAR(512)," +
                "  note VARCHAR(512))",
            "CREATE TABLE IF NOT EXISTS progress(" +
                "  slug VARCHAR(128) PRIMARY KEY," +
                "  status VARCHAR(32)," +          // todo / done / skipped
                "  done_date DATE," +
                "  my_note VARCHAR(1024))",
            "CREATE TABLE IF NOT EXISTS mistake(" +
                "  id BIGINT AUTO_INCREMENT PRIMARY KEY," +
                "  problem_slug VARCHAR(128)," +
                "  problem_title VARCHAR(256)," +
                "  where_stuck VARCHAR(1024)," +
                "  one_liner VARCHAR(1024)," +
                "  tag VARCHAR(64)," +
                "  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP," +
                "  review_count INT DEFAULT 0," +
                "  last_reviewed_at TIMESTAMP," +
                "  mastered BOOLEAN DEFAULT FALSE)",
            "CREATE TABLE IF NOT EXISTS snippet(" +
                "  id BIGINT AUTO_INCREMENT PRIMARY KEY," +
                "  category VARCHAR(64)," +
                "  title VARCHAR(256)," +
                "  code CLOB," +
                "  note VARCHAR(1024)," +
                "  sort_order INT DEFAULT 0," +
                "  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
            // 用户自己在每题下写的代码 + 最近一次评分结果
            // grade_json 存的是整份评分快照，回看时能还原「当时是按什么理由打的分」
            "CREATE TABLE IF NOT EXISTS my_code(" +
                "  slug VARCHAR(128) PRIMARY KEY," +
                "  code CLOB," +
                "  grade_json CLOB," +
                "  total_score DOUBLE," +
                "  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
            "CREATE TABLE IF NOT EXISTS solved_snapshot(" +
                "  slug VARCHAR(128) PRIMARY KEY," +
                "  title VARCHAR(256)," +
                "  difficulty VARCHAR(16)," +
                "  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
            // 复习模式下单独写的代码：和看题页的 my_code 完全隔离，
            // 复习时重写一遍不该覆盖当初第一次写的那份 —— 两份都有回看价值。
            "CREATE TABLE IF NOT EXISTS review_code(" +
                "  mistake_id BIGINT PRIMARY KEY," +
                "  slug VARCHAR(128)," +
                "  code CLOB," +
                "  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
            // 复习卡片：一次复习 = 一张卡，一条错题可以有很多张。
            // review_code 是「一对一」，每次保存都把上一份盖掉 —— 那正是要修的病。
            // 这张表是一对多，历史各自留痕，谁也不覆盖谁。
            "CREATE TABLE IF NOT EXISTS review_card(" +
                "  id BIGINT AUTO_INCREMENT PRIMARY KEY," +
                "  mistake_id BIGINT NOT NULL," +
                "  slug VARCHAR(128)," +
                "  code CLOB," +
                "  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP," +
                "  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
        };
        try (Connection c = conn(); Statement s = c.createStatement()) {
            for (String sql : ddl) s.execute(sql);
        } catch (SQLException e) {
            throw new RuntimeException("建表失败: " + e.getMessage(), e);
        }
        // 建完表顺手把一对一时代的老数据搬成卡片：只搬一次，之后靠「已有卡就不搬」兜住。
        try {
            migrateReviewCodeToCards();
        } catch (RuntimeException e) {
            // 迁移失败不该拦住整个应用启动 —— 老数据还在 review_code 里，下次启动再试。
            System.err.println("复习卡片迁移跳过: " + e.getMessage());
        }
    }

    public void setSetting(String k, String v) {
        try (Connection c = conn();
             PreparedStatement ps = c.prepareStatement(
                 "MERGE INTO setting(k, v) KEY(k) VALUES(?, ?)")) {
            ps.setString(1, k);
            ps.setString(2, v);
            ps.executeUpdate();
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    public String getSetting(String k) {
        try (Connection c = conn();
             PreparedStatement ps = c.prepareStatement("SELECT v FROM setting WHERE k=?")) {
            ps.setString(1, k);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        } catch (SQLException e) { return null; }
    }

    public void deleteSetting(String k) {
        try (Connection c = conn();
             PreparedStatement ps = c.prepareStatement("DELETE FROM setting WHERE k=?")) {
            ps.setString(1, k);
            ps.executeUpdate();
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    // ---------------- progress ----------------

    public Map<String, String[]> allProgress() {
        Map<String, String[]> m = new LinkedHashMap<>();
        try (Connection c = conn();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery("SELECT slug, status, done_date, my_note FROM progress")) {
            while (rs.next()) {
                m.put(rs.getString(1), new String[]{
                    rs.getString(2),
                    rs.getString(3),
                    rs.getString(4)
                });
            }
        } catch (SQLException e) { throw new RuntimeException(e); }
        return m;
    }

    public void markProgress(String slug, String status) {
        try (Connection c = conn();
             PreparedStatement ps = c.prepareStatement(
                 "MERGE INTO progress(slug, status, done_date) KEY(slug) VALUES(?, ?, CURRENT_DATE)")) {
            ps.setString(1, slug);
            ps.setString(2, status);
            ps.executeUpdate();
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    public void noteProgress(String slug, String note) {
        try (Connection c = conn();
             PreparedStatement ps = c.prepareStatement(
                 "UPDATE progress SET my_note=? WHERE slug=?")) {
            ps.setString(1, note);
            ps.setString(2, slug);
            ps.executeUpdate();
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    // ---------------- mistake ----------------

    public List<Map<String, Object>> listMistakes() {
        List<Map<String, Object>> list = new ArrayList<>();
        try (Connection c = conn();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery(
                 "SELECT id, problem_slug, problem_title, where_stuck, one_liner, tag, " +
                 "created_at, review_count, last_reviewed_at, mastered FROM mistake " +
                 "ORDER BY mastered ASC, id DESC")) {
            while (rs.next()) list.add(mapMistake(rs));
        } catch (SQLException e) { throw new RuntimeException(e); }
        return list;
    }

    private Map<String, Object> mapMistake(ResultSet rs) throws SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", rs.getLong("id"));
        m.put("problemSlug", rs.getString("problem_slug"));
        m.put("problemTitle", rs.getString("problem_title"));
        m.put("whereStuck", rs.getString("where_stuck"));
        m.put("oneLiner", rs.getString("one_liner"));
        m.put("tag", rs.getString("tag"));
        Timestamp t = rs.getTimestamp("created_at");
        m.put("createdAt", t == null ? null : t.toString());
        m.put("reviewCount", rs.getInt("review_count"));
        Timestamp r = rs.getTimestamp("last_reviewed_at");
        m.put("lastReviewedAt", r == null ? null : r.toString());
        m.put("mastered", rs.getBoolean("mastered"));
        return m;
    }

    public long addMistake(String slug, String title, String whereStuck, String oneLiner, String tag) {
        try (Connection c = conn();
             PreparedStatement ps = c.prepareStatement(
                 "INSERT INTO mistake(problem_slug, problem_title, where_stuck, one_liner, tag) " +
                 "VALUES(?,?,?,?,?)", Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, slug);
            ps.setString(2, title);
            ps.setString(3, whereStuck);
            ps.setString(4, oneLiner);
            ps.setString(5, tag);
            ps.executeUpdate();
            try (ResultSet rs = ps.getGeneratedKeys()) {
                return rs.next() ? rs.getLong(1) : -1;
            }
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    public void reviewMistake(long id) {
        try (Connection c = conn();
             PreparedStatement ps = c.prepareStatement(
                 "UPDATE mistake SET review_count = review_count + 1, last_reviewed_at = CURRENT_TIMESTAMP WHERE id=?")) {
            ps.setLong(1, id);
            ps.executeUpdate();
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    public void setMastered(long id, boolean mastered) {
        try (Connection c = conn();
             PreparedStatement ps = c.prepareStatement("UPDATE mistake SET mastered=? WHERE id=?")) {
            ps.setBoolean(1, mastered);
            ps.setLong(2, id);
            ps.executeUpdate();
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    public void deleteMistake(long id) {
        try (Connection c = conn();
             PreparedStatement ps = c.prepareStatement("DELETE FROM mistake WHERE id=?")) {
            ps.setLong(1, id);
            ps.executeUpdate();
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    // ---------------- snippet ----------------

    public List<Map<String, Object>> listSnippets() {
        List<Map<String, Object>> list = new ArrayList<>();
        try (Connection c = conn();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery(
                 "SELECT id, category, title, code, note, sort_order FROM snippet " +
                 "ORDER BY sort_order ASC, id ASC")) {
            while (rs.next()) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", rs.getLong("id"));
                m.put("category", rs.getString("category"));
                m.put("title", rs.getString("title"));
                m.put("code", rs.getString("code"));
                m.put("note", rs.getString("note"));
                m.put("sortOrder", rs.getInt("sort_order"));
                list.add(m);
            }
        } catch (SQLException e) { throw new RuntimeException(e); }
        return list;
    }

    public long addSnippet(String category, String title, String code, String note, int order) {
        try (Connection c = conn();
             PreparedStatement ps = c.prepareStatement(
                 "INSERT INTO snippet(category, title, code, note, sort_order) VALUES(?,?,?,?,?)",
                 Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, category);
            ps.setString(2, title);
            ps.setString(3, code);
            ps.setString(4, note);
            ps.setInt(5, order);
            ps.executeUpdate();
            try (ResultSet rs = ps.getGeneratedKeys()) {
                return rs.next() ? rs.getLong(1) : -1;
            }
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    public void deleteSnippet(long id) {
        try (Connection c = conn();
             PreparedStatement ps = c.prepareStatement("DELETE FROM snippet WHERE id=?")) {
            ps.setLong(1, id);
            ps.executeUpdate();
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    public int countSnippets() {
        try (Connection c = conn();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery("SELECT COUNT(*) FROM snippet")) {
            return rs.next() ? rs.getInt(1) : 0;
        } catch (SQLException e) { return 0; }
    }

    // ---------------- solved snapshot ----------------

    /**
     * 用一次同步的结果整体替换快照，并把「力扣上已通过」的题回写进 progress。
     *
     * 为什么必须回写 progress：这两张表原本是割裂的 —— solved_snapshot 只给账号页看，
     * progress 才决定计划里显示 todo 还是 done。不同步回写的话，用户明明在力扣上 AC 了，
     * 计划里还是让他重做一遍，等于这个「复用账号」的功能是假的。
     *
     * 只补不删：progress 里用户手动标过的 done 不会被同步结果覆盖掉
     * （比如他在别的地方做过但力扣没记录，或者是本地的练习记录）。
     */
    public void replaceSolved(Map<String, String[]> solved) {
        try (Connection c = conn()) {
            c.setAutoCommit(false);
            try (Statement s = c.createStatement()) {
                s.executeUpdate("DELETE FROM solved_snapshot");
            }
            try (PreparedStatement ps = c.prepareStatement(
                     "INSERT INTO solved_snapshot(slug, title, difficulty) VALUES(?,?,?)")) {
                for (Map.Entry<String, String[]> e : solved.entrySet()) {
                    ps.setString(1, e.getKey());
                    ps.setString(2, e.getValue()[0]);
                    ps.setString(3, e.getValue()[1]);
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            // 回写进度：已通过的直接标 done。
            // 注意不能用 MERGE INTO ... KEY(slug) —— 那是整行替换，会把用户的 my_note 抹掉。
            // 所以拆成 UPDATE（保留 note 和已有 done_date）+ INSERT（只补原来没有的行）。
            String today = java.time.LocalDate.now().toString();
            try (PreparedStatement ps = c.prepareStatement(
                     "UPDATE progress SET status = 'done', done_date = COALESCE(done_date, ?) WHERE slug = ?")) {
                for (String slug : solved.keySet()) {
                    ps.setString(1, today);
                    ps.setString(2, slug);
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            try (PreparedStatement ps = c.prepareStatement(
                     "INSERT INTO progress(slug, status, done_date) "
                     + "SELECT ?, 'done', ? WHERE NOT EXISTS (SELECT 1 FROM progress WHERE slug = ?)")) {
                for (String slug : solved.keySet()) {
                    ps.setString(1, slug);
                    ps.setString(2, today);
                    ps.setString(3, slug);
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            c.commit();
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    // ---------------- 通用工具（给小功能复用，避免每处都手写 try-with-resources） ----------------

    /** 执行无返回值的 DDL */
    public void exec(String sql) {
        try (Connection c = conn(); Statement s = c.createStatement()) {
            s.execute(sql);
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    /** 执行带参数的 DML（INSERT / UPDATE / DELETE） */
    public int update(String sql, Object... args) {
        try (Connection c = conn(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
            return ps.executeUpdate();
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    /** 查询单个 long 值，用于 COUNT(*) 这类聚合 */
    public long queryLong(String sql, Object... args) {
        try (Connection c = conn(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getLong(1) : 0L;
            }
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    /** 逐行读取查询结果。回调允许抛 SQLException，否则 lambda 里没法直接调 rs.getLong() */
    public interface RowHandler {
        void handle(ResultSet rs) throws SQLException;
    }

    public void each(String sql, RowHandler fn, Object... args) {
        try (Connection c = conn(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) fn.handle(rs);
            }
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    public List<Map<String, Object>> listSolved() {
        List<Map<String, Object>> list = new ArrayList<>();
        try (Connection c = conn();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery(
                 "SELECT slug, title, difficulty, synced_at FROM solved_snapshot ORDER BY slug")) {
            while (rs.next()) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("slug", rs.getString(1));
                m.put("title", rs.getString(2));
                m.put("difficulty", rs.getString(3));
                Timestamp t = rs.getTimestamp(4);
                m.put("syncedAt", t == null ? null : t.toString());
                list.add(m);
            }
        } catch (SQLException e) { throw new RuntimeException(e); }
        return list;
    }

    // ---------------- 我写的代码（每题一份） ----------------

    /** 保存用户在某道题下写的代码 + 评分快照。一道题只留最新一份（PK 是 slug）。 */
    public void saveMyCode(String slug, String code, String gradeJson, double totalScore) {
        // 先 UPDATE，命中不到再 INSERT —— 一条 SQL 有两种语义，分开写比 MERGE 更可控
        int n = update("UPDATE my_code SET code = ?, grade_json = ?, total_score = ?, "
                + "updated_at = CURRENT_TIMESTAMP WHERE slug = ?", code, gradeJson, totalScore, slug);
        if (n == 0) {
            update("INSERT INTO my_code(slug, code, grade_json, total_score) VALUES(?,?,?,?)",
                    slug, code, gradeJson, totalScore);
        }
    }

    /** 取一道题下用户写的代码和上次评分；没有返回 null。 */
    public Map<String, Object> getMyCode(String slug) {
        try (Connection c = conn();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT slug, code, grade_json, total_score, updated_at FROM my_code WHERE slug = ?")) {
            ps.setString(1, slug);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("slug", rs.getString(1));
                m.put("code", rs.getString(2));
                m.put("gradeJson", rs.getString(3));
                m.put("totalScore", rs.getDouble(4));
                Timestamp t = rs.getTimestamp(5);
                m.put("updatedAt", t == null ? null : t.toString());
                return m;
            }
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    // ---------------- 复习模式的代码（按错题隔离，不碰 my_code） ----------------

    /** 保存复习时写的代码。PK 是 mistake_id：一条错题一份，与看题页的 my_code 互不影响。 */
    public void saveReviewCode(long mistakeId, String slug, String code) {
        int n = update("UPDATE review_code SET code = ?, slug = ?, "
                + "updated_at = CURRENT_TIMESTAMP WHERE mistake_id = ?", code, slug, mistakeId);
        if (n == 0) {
            update("INSERT INTO review_code(mistake_id, slug, code) VALUES(?,?,?)",
                    mistakeId, slug, code);
        }
    }

    /** 取某条错题复习时写的代码；没写过返回 null。 */
    public String getReviewCode(long mistakeId) {
        try (Connection c = conn();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT code FROM review_code WHERE mistake_id = ?")) {
            ps.setLong(1, mistakeId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    // ---------------- 复习卡片（一次复习一张卡，一对多，永不覆盖） ----------------

    /**
     * 某条错题的全部复习卡片，最新的在最前面。
     * seq 是「第几次复习」的人话编号：按 created_at 正序数出来的位置，
     * 删了中间一张也不会让后面的编号错位 —— 前端只拿它做展示，不当主键用。
     */
    public List<Map<String, Object>> listReviewCards(long mistakeId) {
        List<Map<String, Object>> asc = new ArrayList<>();
        each("SELECT id, code, created_at, updated_at FROM review_card "
                + "WHERE mistake_id = ? ORDER BY created_at ASC, id ASC", rs -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", rs.getLong(1));
            m.put("code", rs.getString(2) == null ? "" : rs.getString(2));
            Timestamp c = rs.getTimestamp(3);
            m.put("createdAt", c == null ? null : c.toString());
            Timestamp u = rs.getTimestamp(4);
            m.put("updatedAt", u == null ? null : u.toString());
            asc.add(m);
        }, mistakeId);
        // 编号按时间正序发，返回时倒序 —— 展示要「最新的压在最上面」。
        List<Map<String, Object>> desc = new ArrayList<>(asc.size());
        for (int i = asc.size() - 1; i >= 0; i--) {
            Map<String, Object> m = asc.get(i);
            m.put("seq", i + 1);
            desc.add(m);
        }
        return desc;
    }

    /** 新增一张复习卡片，返回它的 id。只 INSERT，绝不 UPDATE 别人。 */
    public long addReviewCard(long mistakeId, String slug, String code) {
        try (Connection c = conn();
             PreparedStatement ps = c.prepareStatement(
                     "INSERT INTO review_card(mistake_id, slug, code) VALUES(?,?,?)",
                     Statement.RETURN_GENERATED_KEYS)) {
            ps.setLong(1, mistakeId);
            ps.setString(2, slug);
            ps.setString(3, code);
            ps.executeUpdate();
            try (ResultSet rs = ps.getGeneratedKeys()) {
                return rs.next() ? rs.getLong(1) : -1L;
            }
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    /** 删一张卡片；带上 mistakeId 是防止拿别人的 cardId 越权删。返回是否真的删掉了。 */
    public boolean deleteReviewCard(long mistakeId, long cardId) {
        return update("DELETE FROM review_card WHERE id = ? AND mistake_id = ?",
                cardId, mistakeId) > 0;
    }

    public long countReviewCards(long mistakeId) {
        return queryLong("SELECT COUNT(*) FROM review_card WHERE mistake_id = ?", mistakeId);
    }

    /**
     * 老数据迁移：review_code 里已有的那份代码（一对一时代存的）转成第 1 张卡片。
     * 只在该错题一张卡都没有时做，避免每次启动都插一份重复的。
     * 老表不删 —— 万一迁移出问题还能回退。
     */
    public void migrateReviewCodeToCards() {
        // 先把老表整份读进内存，再逐条插入 —— 不能在 each() 的 ResultSet 迭代里再开连接写库。
        List<Object[]> pending = new ArrayList<>();
        each("SELECT mistake_id, slug, code FROM review_code",
                rs -> pending.add(new Object[]{rs.getLong(1), rs.getString(2), rs.getString(3)}));
        for (Object[] row : pending) {
            long mid = (Long) row[0];
            if (countReviewCards(mid) > 0) continue;
            addReviewCard(mid, (String) row[1], (String) row[2]);
        }
    }

    /** 所有写过代码的题：slug -> 分数。给题库列表显示「我拿了几分」。 */    public Map<String, Double> allMyScores() {
        Map<String, Double> m = new LinkedHashMap<>();
        each("SELECT slug, total_score FROM my_code", rs -> {
            m.put(rs.getString(1), rs.getDouble(2));
        });
        return m;
    }
}
