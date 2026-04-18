-- Gravity Claw Memory Schema
-- Run this in your Supabase SQL Editor (https://supabase.com)

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Episodic memory: every conversation turn stored with embedding
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  embedding vector(1024),
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- HNSW index for fast vector similarity search
CREATE INDEX IF NOT EXISTS idx_memories_embedding
ON memories USING hnsw (embedding vector_cosine_ops);

-- Index for user-scoped queries
CREATE INDEX IF NOT EXISTS idx_memories_user_created
ON memories(user_id, created_at DESC);

-- Semantic memory: distilled facts about the user
CREATE TABLE IF NOT EXISTS user_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  fact_type TEXT NOT NULL CHECK (fact_type IN ('preference', 'biography', 'goal', 'relationship', 'habit')),
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  confidence FLOAT DEFAULT 1.0,
  embedding vector(1024),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast fact lookup by user
CREATE INDEX IF NOT EXISTS idx_user_facts_user
ON user_facts(user_id, fact_type);

-- RPC: semantic search over episodic memory
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1024),
  match_user_id BIGINT,
  match_count INT DEFAULT 5,
  similarity_threshold FLOAT DEFAULT 0.5
)
RETURNS TABLE(
  id UUID,
  content TEXT,
  role TEXT,
  similarity FLOAT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.content,
    m.role,
    1 - (m.embedding <=> query_embedding) AS similarity,
    m.created_at
  FROM memories m
  WHERE m.user_id = match_user_id
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > similarity_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- RPC: semantic search over user facts
CREATE OR REPLACE FUNCTION match_facts(
  query_embedding vector(1024),
  match_user_id BIGINT,
  match_count INT DEFAULT 5,
  similarity_threshold FLOAT DEFAULT 0.5
)
RETURNS TABLE(
  id UUID,
  fact_type TEXT,
  fact_key TEXT,
  fact_value TEXT,
  similarity FLOAT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id,
    f.fact_type,
    f.fact_key,
    f.fact_value,
    1 - (f.embedding <=> query_embedding) AS similarity,
    f.updated_at
  FROM user_facts f
  WHERE f.user_id = match_user_id
    AND f.embedding IS NOT NULL
    AND 1 - (f.embedding <=> query_embedding) > similarity_threshold
  ORDER BY f.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- RPC: get all facts for a user (for system prompt injection)
CREATE OR REPLACE FUNCTION get_user_facts(match_user_id BIGINT)
RETURNS TABLE(
  id UUID,
  fact_type TEXT,
  fact_key TEXT,
  fact_value TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT f.id, f.fact_type, f.fact_key, f.fact_value, f.updated_at
  FROM user_facts f
  WHERE f.user_id = match_user_id
  ORDER BY f.updated_at DESC;
END;
$$;
