-- 001: расширения PostgreSQL.
-- pg_trgm  — нечёткое сравнение названий компаний/проектов (entity resolution).
-- unaccent — снятие диакритики перед нормализацией.
-- btree_gin — составные GIN-индексы (скаляр + jsonb) в одном индексе.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;
