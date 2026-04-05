-- 说明：服务启动和 `npm run init-db` 均会自动初始化以下结构。

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
  UNIQUE KEY uniq_event_voter_candidate (event_id, voter_token, candidate_id),
  KEY idx_event_candidate (event_id, candidate_id),
  KEY idx_vote_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lottery_winner (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  event_id BIGINT NOT NULL,
  student_id VARCHAR(12) NOT NULL,
  round INT NOT NULL DEFAULT 1 COMMENT '抽奖轮次',
  is_displayed TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否在前台展示',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_lottery_event (event_id),
  KEY idx_lottery_display (event_id, is_displayed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
