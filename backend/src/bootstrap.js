import { query } from "./db.js";
import { config } from "./config.js";

const schemaStatements = [
  `
  CREATE TABLE IF NOT EXISTS vote_event (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_code VARCHAR(64) NOT NULL,
    event_name VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    start_time DATETIME NULL,
    end_time DATETIME NULL,
    rule_json JSON NULL,
    result_visible TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_event_code (event_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,
  `
  CREATE TABLE IF NOT EXISTS vote_candidate (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_id BIGINT NOT NULL,
    candidate_code VARCHAR(64) NOT NULL,
    candidate_name VARCHAR(64) NOT NULL,
    academy VARCHAR(64) NULL,
    major_name VARCHAR(64) NULL,
    song_name VARCHAR(128) NULL,
    avatar_url VARCHAR(512) NULL,
    display_order INT NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_event_candidate_code (event_id, candidate_code),
    KEY idx_candidate_event (event_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,
  `
  CREATE TABLE IF NOT EXISTS vote_record (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    vote_id VARCHAR(64) NOT NULL,
    event_id BIGINT NOT NULL,
    candidate_id BIGINT NOT NULL,
    voter_token VARCHAR(128) NOT NULL,
    student_id VARCHAR(12) NULL,
    client_ip VARCHAR(64) NULL,
    user_agent VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_vote_id (vote_id),
    UNIQUE KEY uniq_event_voter (event_id, voter_token),
    KEY idx_event_candidate (event_id, candidate_id),
    KEY idx_vote_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
];

const migrationStatements = [
  `ALTER TABLE vote_record MODIFY COLUMN voter_token VARCHAR(128) NOT NULL`,
  `ALTER TABLE vote_record DROP INDEX uniq_event_phone`,
  `ALTER TABLE vote_record DROP INDEX idx_event_phone`,
  `ALTER TABLE vote_record DROP COLUMN phone_number`,
  `ALTER TABLE vote_record DROP INDEX uniq_event_voter`,
  `ALTER TABLE vote_candidate ADD COLUMN major_name VARCHAR(64) NULL AFTER academy`,
  `ALTER TABLE vote_record ADD COLUMN student_id VARCHAR(12) NULL AFTER voter_token`
];

const ensureUniqueIndex = async (tableName, indexName, columns) => {
  const rows = await query(
    `
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = ?
      AND index_name = ?
    LIMIT 1
    `,
    [tableName, indexName]
  );

  if (rows.length > 0) {
    return;
  }

  await query(`CREATE UNIQUE INDEX ${indexName} ON ${tableName} (${columns.join(", ")})`);
};

const seedCandidates = [
  {
    candidateCode: "singer-01",
    candidateName: "林沐",
    academy: "信息工程学院",
    majorName: "软件工程",
    songName: "夜空中最亮的星",
    avatarUrl:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=600&q=80",
    displayOrder: 1
  },
  {
    candidateCode: "singer-02",
    candidateName: "周屿",
    academy: "经济管理学院",
    majorName: "金融学",
    songName: "平凡之路",
    avatarUrl:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=600&q=80",
    displayOrder: 2
  },
  {
    candidateCode: "singer-03",
    candidateName: "陈夏",
    academy: "外国语学院",
    majorName: "英语",
    songName: "后来",
    avatarUrl:
      "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=600&q=80",
    displayOrder: 3
  },
  {
    candidateCode: "singer-04",
    candidateName: "许舟",
    academy: "土木工程学院",
    majorName: "建筑学",
    songName: "海阔天空",
    avatarUrl:
      "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=600&q=80",
    displayOrder: 4
  },
  {
    candidateCode: "singer-05",
    candidateName: "沈知遥",
    academy: "艺术学院",
    majorName: "音乐表演",
    songName: "这世界那么多人",
    avatarUrl:
      "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80",
    displayOrder: 5
  }
];

const ensureEvent = async () => {
  await query(
    `
    INSERT INTO vote_event (
      event_code,
      event_name,
      status,
      start_time,
      end_time,
      rule_json,
      result_visible
    ) VALUES (?, ?, 'active', DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_ADD(NOW(), INTERVAL 90 DAY), JSON_OBJECT('mode', 'single', 'maxSelections', 1), 1)
    ON DUPLICATE KEY UPDATE
      event_name = VALUES(event_name),
      updated_at = CURRENT_TIMESTAMP
    `,
    [config.eventCode, "校园歌手大赛人气投票"]
  );

  const rows = await query(`SELECT id FROM vote_event WHERE event_code = ? LIMIT 1`, [
    config.eventCode
  ]);

  if (!rows.length) {
    throw new Error("初始化事件失败：无法查询到 vote_event");
  }

  return rows[0].id;
};

const ensureCandidates = async (eventId) => {
  for (const item of seedCandidates) {
    await query(
      `
      INSERT INTO vote_candidate (
        event_id,
        candidate_code,
        candidate_name,
        academy,
        major_name,
        song_name,
        avatar_url,
        display_order,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
      ON DUPLICATE KEY UPDATE
        candidate_name = VALUES(candidate_name),
        academy = VALUES(academy),
        major_name = VALUES(major_name),
        song_name = VALUES(song_name),
        avatar_url = VALUES(avatar_url),
        display_order = VALUES(display_order),
        status = 'active',
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        eventId,
        item.candidateCode,
        item.candidateName,
        item.academy,
        item.majorName,
        item.songName,
        item.avatarUrl,
        item.displayOrder
      ]
    );
  }
};

export const ensureSchemaAndSeed = async () => {
  for (const statement of schemaStatements) {
    await query(statement);
  }

  await ensureUniqueIndex("vote_record", "uniq_event_voter_candidate", [
    "event_id",
    "voter_token",
    "candidate_id"
  ]);

  for (const statement of migrationStatements) {
    try {
      await query(statement);
    } catch (error) {
      if (
        error?.code !== "ER_CANT_DROP_FIELD_OR_KEY" &&
        error?.code !== "ER_DUP_KEYNAME" &&
        error?.code !== "ER_DUP_ENTRY" &&
        error?.code !== "ER_DUP_FIELDNAME"
      ) {
        throw error;
      }
    }
  }

  const eventId = await ensureEvent();
  await ensureCandidates(eventId);
};
