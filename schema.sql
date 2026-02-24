-- MurMur AI Database Schema

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT,
  credits       INT DEFAULT 0,
  reset_token   TEXT,
  reset_expires TIMESTAMPTZ,
  has_seen_onboarding BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id         SERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
  id          SERIAL PRIMARY KEY,
  user_id     INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT,
  target_role TEXT,
  years_exp   INT,
  tech_stack  TEXT[],
  skills      JSONB,
  projects    TEXT,
  resume_text TEXT,
  jd_text     TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS questions (
  id               SERIAL PRIMARY KEY,
  session_id       INT REFERENCES sessions(id) ON DELETE CASCADE,
  transcript       TEXT NOT NULL,
  cleaned_question TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS answers (
  id                    SERIAL PRIMARY KEY,
  question_id           INT REFERENCES questions(id) ON DELETE CASCADE,
  gemini_output         TEXT,
  raw_response          TEXT,
  status                TEXT    NOT NULL DEFAULT 'processing',
  processing_started_at TIMESTAMPTZ DEFAULT NOW(),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id               SERIAL PRIMARY KEY,
  user_id          INT REFERENCES users(id) ON DELETE CASCADE,
  razorpay_order_id TEXT UNIQUE NOT NULL,
  amount           INT NOT NULL,
  currency         TEXT DEFAULT 'INR',
  status           TEXT DEFAULT 'pending',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resumes (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT,
  filename    TEXT NOT NULL,
  content     TEXT,
  is_active   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Migration: add title column if missing
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS title TEXT;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS interviews (
  id              SERIAL PRIMARY KEY,
  user_id         INT REFERENCES users(id) ON DELETE CASCADE,
  resume_id       INT REFERENCES resumes(id) ON DELETE SET NULL,
  type            TEXT NOT NULL DEFAULT 'test',
  status          TEXT NOT NULL DEFAULT 'upcoming',
  job_description TEXT,
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for scaling
CREATE INDEX IF NOT EXISTS idx_questions_session  ON questions(session_id);
CREATE INDEX IF NOT EXISTS idx_answers_question   ON answers(question_id);
CREATE INDEX IF NOT EXISTS idx_users_email        ON users(email);
CREATE INDEX IF NOT EXISTS idx_interviews_user    ON interviews(user_id);
