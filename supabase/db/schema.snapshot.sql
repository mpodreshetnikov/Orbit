--
-- PostgreSQL database dump
--
-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: checkup_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."checkup_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "person_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "category" "public"."checkup_category" NOT NULL,
    "schedule" "jsonb" NOT NULL,
    "next_due_at" "date",
    "status" "public"."checkup_item_status" DEFAULT 'active'::"public"."checkup_item_status" NOT NULL,
    "why_text" "text",
    "why_links" "jsonb" DEFAULT '[]'::"jsonb",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reminder_days_before" integer[] DEFAULT ARRAY[7] NOT NULL,
    "planned_on" "date"
);


--
-- Name: allowed_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."allowed_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid",
    "email" "text" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: body_site_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."body_site_catalog" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_code" "text" NOT NULL,
    "name_ru" "text" NOT NULL,
    "name_en" "text" NOT NULL,
    "parent_site_code" "text",
    "synonyms_ru" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "synonyms_en" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: checkup_completions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."checkup_completions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "checkup_item_id" "uuid" NOT NULL,
    "done_at" "date" NOT NULL,
    "note" "text",
    "evidence_record_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: condition_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."condition_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "condition_id" "uuid" NOT NULL,
    "record_id" "uuid" NOT NULL,
    "status_in_record" "text" NOT NULL,
    "source_anchor" "text",
    "confidence" numeric,
    "is_llm_extracted" boolean DEFAULT true NOT NULL,
    "is_user_verified" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "condition_records_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))),
    CONSTRAINT "condition_records_status_in_record_check" CHECK (("status_in_record" = ANY (ARRAY['active'::"text", 'resolved'::"text", 'suspected'::"text", 'history'::"text"])))
);


--
-- Name: conditions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."conditions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "person_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "icd_name_en" "text",
    "code" "text",
    "current_status" "text" DEFAULT 'suspected'::"text" NOT NULL,
    "onset_date" "date",
    "resolved_date" "date",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "icd_name_ru" "text",
    CONSTRAINT "conditions_current_status_check" CHECK (("current_status" = ANY (ARRAY['active'::"text", 'resolved'::"text", 'suspected'::"text", 'history'::"text"])))
);


--
-- Name: db_deploy_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."db_deploy_log" (
    "id" integer NOT NULL,
    "deployed_at" timestamp with time zone DEFAULT "now"(),
    "git_sha" "text",
    "deployer" "text" DEFAULT CURRENT_USER
);


--
-- Name: db_deploy_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."db_deploy_log_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: db_deploy_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."db_deploy_log_id_seq" OWNED BY "public"."db_deploy_log"."id";


--
-- Name: finding_type_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."finding_type_catalog" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "finding_code" "text" NOT NULL,
    "name_ru" "text" NOT NULL,
    "name_en" "text" NOT NULL,
    "synonyms_ru" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "synonyms_en" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: measurement_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."measurement_catalog" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name_ru" "text" NOT NULL,
    "name_en" "text" NOT NULL,
    "unit_ru" "text" NOT NULL,
    "unit_en" "text" NOT NULL,
    "category" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "measurement_catalog_category_check" CHECK (("category" = ANY (ARRAY['basic'::"text", 'body'::"text", 'limbs'::"text", 'vital'::"text"])))
);


--
-- Name: measurements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."measurements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "person_id" "uuid" NOT NULL,
    "catalog_id" "uuid" NOT NULL,
    "value" numeric NOT NULL,
    "measured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text",
    "created_by_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: med_dose_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."med_dose_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "person_id" "uuid" NOT NULL,
    "regimen_id" "uuid" NOT NULL,
    "scheduled_at" timestamp with time zone NOT NULL,
    "actual_at" timestamp with time zone NOT NULL,
    "planned_intake" "jsonb" NOT NULL,
    "status" "public"."med_dose_event_status" DEFAULT 'scheduled'::"public"."med_dose_event_status" NOT NULL,
    "taken_at" timestamp with time zone,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


--
-- Name: med_inventory_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."med_inventory_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "regimen_id" "uuid" NOT NULL,
    "event_id" "uuid",
    "type" "public"."med_inventory_transaction_type" NOT NULL,
    "amount" numeric NOT NULL,
    "unit" "text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: med_regimens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."med_regimens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "person_id" "uuid" NOT NULL,
    "custom_name" "text" NOT NULL,
    "status" "public"."medication_status" DEFAULT 'active'::"public"."medication_status" NOT NULL,
    "intake_unit" "public"."medication_unit" DEFAULT 'pill'::"public"."medication_unit" NOT NULL,
    "dose_definition" "jsonb",
    "intake_advice_type" "public"."med_intake_advice_type" DEFAULT 'none'::"public"."med_intake_advice_type",
    "intake_advice_text" "text",
    "schedule" "jsonb" NOT NULL,
    "duration" "jsonb" NOT NULL,
    "reminder_prefs" "jsonb",
    "inventory" "jsonb",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


--
-- Name: medical_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."medical_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "person_id" "uuid" NOT NULL,
    "created_by_user_id" "uuid" NOT NULL,
    "record_type" "public"."record_type" DEFAULT 'other'::"public"."record_type" NOT NULL,
    "record_date" "date",
    "title" "text" NOT NULL,
    "notes" "text",
    "status" "public"."record_status" DEFAULT 'draft'::"public"."record_status" NOT NULL,
    "removed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ocr_text" "text",
    "llm_summary" "text",
    "llm_keywords" "text"[],
    "search_vector" "tsvector" GENERATED ALWAYS AS ((("setweight"("to_tsvector"('"english"'::"regconfig", COALESCE("title", ''::"text")), 'A'::"char") || "setweight"("to_tsvector"('"english"'::"regconfig", COALESCE("notes", ''::"text")), 'B'::"char")) || "setweight"("to_tsvector"('"english"'::"regconfig", COALESCE("ocr_text", ''::"text")), 'C'::"char"))) STORED,
    "ocr_error" "text",
    "llm_suggested_checkup_completions" "jsonb"
);

ALTER TABLE ONLY "public"."medical_records" REPLICA IDENTITY FULL;


--
-- Name: money_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."money_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_person_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "account_kind" "text" NOT NULL,
    "account_label" "text" NOT NULL,
    "currency" character(3) NOT NULL,
    "external_account_id" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "money_accounts_account_kind_check" CHECK (("account_kind" = ANY (ARRAY['card'::"text", 'debit'::"text", 'credit'::"text", 'cash'::"text"])))
);


--
-- Name: money_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."money_cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "last4" "text" NOT NULL,
    "card_label" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: money_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."money_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "parent_id" "uuid",
    "depth" integer NOT NULL,
    "name_ru" "text" NOT NULL,
    "name_en" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "money_categories_depth_check" CHECK ((("depth" >= 1) AND ("depth" <= 4)))
);


--
-- Name: money_import_batch_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."money_import_batch_rows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "parent_row_id" "uuid",
    "row_kind" "text" NOT NULL,
    "source_row_index" integer NOT NULL,
    "source_line_index" integer,
    "status" "text" NOT NULL,
    "message" "text",
    "transaction_id" "uuid",
    "line_item_id" "uuid",
    "payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "money_import_batch_rows_row_kind_check" CHECK (("row_kind" = ANY (ARRAY['transaction'::"text", 'line_item'::"text"]))),
    CONSTRAINT "money_import_batch_rows_status_check" CHECK (("status" = ANY (ARRAY['inserted'::"text", 'skipped'::"text", 'error'::"text"])))
);


--
-- Name: money_import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."money_import_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source" "text" NOT NULL,
    "payer_person_id" "uuid" NOT NULL,
    "import_type" "text" DEFAULT 'file'::"text" NOT NULL,
    "file_path" "text",
    "meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "session_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "window_from" timestamp with time zone,
    "window_to" timestamp with time zone,
    "parsed_through_at" timestamp with time zone,
    "parsed_transactions_count" integer DEFAULT 0 NOT NULL,
    "inserted_count" integer DEFAULT 0 NOT NULL,
    "skipped_count" integer DEFAULT 0 NOT NULL,
    "error_count" integer DEFAULT 0 NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "money_import_batches_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'discarded'::"text"])))
);


--
-- Name: money_import_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."money_import_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token_hash" "text" NOT NULL,
    "source" "text" NOT NULL,
    "payer_person_id" "uuid" NOT NULL,
    "created_by_auth_user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'created'::"text" NOT NULL,
    "window_from" timestamp with time zone,
    "window_to" timestamp with time zone,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "batch_id" "uuid",
    "meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "money_import_sessions_status_check" CHECK (("status" = ANY (ARRAY['created'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'expired'::"text", 'revoked'::"text"])))
);


--
-- Name: money_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."money_line_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "quantity" numeric,
    "unit" "text",
    "line_status" "public"."money_line_status" DEFAULT 'final'::"public"."money_line_status" NOT NULL,
    "related_line_item_id" "uuid",
    "category_id" "uuid",
    "beneficiary_person_id" "uuid",
    "assignment_method" "public"."money_assignment_method" DEFAULT 'manual'::"public"."money_assignment_method" NOT NULL,
    "assignment_rule_id" "uuid",
    "assignment_confidence" numeric,
    "raw_payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "import_hash" "text"
);


--
-- Name: money_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."money_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payer_person_id" "uuid" NOT NULL,
    "account_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "external_id" "text",
    "posted_at" timestamp with time zone NOT NULL,
    "amount" numeric NOT NULL,
    "currency" character(3) NOT NULL,
    "transaction_type" "public"."money_transaction_type" NOT NULL,
    "status" "public"."money_transaction_status" DEFAULT 'posted'::"public"."money_transaction_status" NOT NULL,
    "merchant_name" "text",
    "mcc" "text",
    "comment" "text",
    "is_transfer" boolean DEFAULT false NOT NULL,
    "transfer_group_id" "uuid",
    "raw_payload" "jsonb",
    "dedupe_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "card_id" "uuid",
    "source_comment" "text",
    "cashback_amount" numeric,
    "cashback_currency" "text"
);


--
-- Name: notification_digests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notification_digests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "scheduled_at" timestamp with time zone NOT NULL,
    "payload_json" "jsonb" NOT NULL,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "window_start" timestamp with time zone,
    "window_end" timestamp with time zone,
    "person_id" "uuid"
);


--
-- Name: notification_routing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notification_routing" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "person_id" "uuid" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "custom_prefix" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: observation_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."observation_catalog" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "obs_code" "text" NOT NULL,
    "name_ru" "text" NOT NULL,
    "name_en" "text" NOT NULL,
    "canonical_unit" "text" NOT NULL,
    "synonyms_ru" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "synonyms_en" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "accepted_units" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "default_ref_low" numeric,
    "default_ref_high" numeric
);


--
-- Name: persons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."persons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "species" "text",
    "birthday" "date",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "auth_user_id" "uuid",
    "sex" "text",
    "breed" "text",
    CONSTRAINT "persons_kind_check" CHECK (("kind" = ANY (ARRAY['human'::"text", 'pet'::"text"]))),
    CONSTRAINT "persons_sex_check" CHECK ((("sex" IS NULL) OR ("sex" = ANY (ARRAY['male'::"text", 'female'::"text", 'other'::"text"]))))
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: record_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."record_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "record_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "original_filename" "text" NOT NULL,
    "file_size" bigint,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: record_findings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."record_findings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "person_id" "uuid" NOT NULL,
    "record_id" "uuid" NOT NULL,
    "finding_type_id" "uuid",
    "finding_code" "text",
    "finding_type_text" "text" NOT NULL,
    "body_site_id" "uuid",
    "site_code" "text",
    "body_site_text" "text",
    "size_mm" numeric,
    "count" integer DEFAULT 1,
    "severity" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "laterality" "text" DEFAULT 'none'::"text" NOT NULL,
    "morphology" "text",
    "description" "text",
    "histology" "text",
    "finding_date" "date",
    "source_anchor" "text" NOT NULL,
    "is_llm_extracted" boolean DEFAULT true NOT NULL,
    "is_user_verified" boolean DEFAULT false NOT NULL,
    "confidence" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "record_findings_laterality_check" CHECK (("laterality" = ANY (ARRAY['left'::"text", 'right'::"text", 'bilateral'::"text", 'none'::"text"]))),
    CONSTRAINT "record_findings_severity_check" CHECK (("severity" = ANY (ARRAY['mild'::"text", 'moderate'::"text", 'severe'::"text", 'unknown'::"text"])))
);


--
-- Name: record_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."record_observations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "record_id" "uuid" NOT NULL,
    "catalog_id" "uuid",
    "obs_code" "text",
    "obs_name" "text" NOT NULL,
    "value_numeric" numeric,
    "value_text" "text",
    "unit" "text",
    "value_canonical" numeric,
    "unit_canonical" "text",
    "ref_range_text" "text",
    "ref_range_low" numeric,
    "ref_range_high" numeric,
    "status" "text",
    "is_llm_extracted" boolean DEFAULT true NOT NULL,
    "is_user_verified" boolean DEFAULT false NOT NULL,
    "confidence" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ref_range_low_canonical" numeric,
    "ref_range_high_canonical" numeric,
    "is_applied" boolean DEFAULT true NOT NULL,
    CONSTRAINT "record_observations_status_check" CHECK (("status" = ANY (ARRAY['normal'::"text", 'low'::"text", 'high'::"text", 'critical_low'::"text", 'critical_high'::"text", 'unknown'::"text"])))
);


--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."user_preferences" (
    "auth_user_id" "uuid" NOT NULL,
    "checkup_notification_time" time without time zone DEFAULT '09:00:00'::time without time zone NOT NULL,
    "checkup_notification_timezone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "overdue_reminder_interval_minutes" integer DEFAULT 30 NOT NULL
);


--
-- Name: db_deploy_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."db_deploy_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."db_deploy_log_id_seq"'::"regclass");


--
-- PostgreSQL database dump complete
--

--
-- PostgreSQL database dump
--
-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

--
-- Name: allowed_users allowed_users_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."allowed_users"
    ADD CONSTRAINT "allowed_users_auth_user_id_key" UNIQUE ("auth_user_id");


--
-- Name: allowed_users allowed_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."allowed_users"
    ADD CONSTRAINT "allowed_users_email_key" UNIQUE ("email");


--
-- Name: allowed_users allowed_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."allowed_users"
    ADD CONSTRAINT "allowed_users_pkey" PRIMARY KEY ("id");


--
-- Name: body_site_catalog body_site_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."body_site_catalog"
    ADD CONSTRAINT "body_site_catalog_pkey" PRIMARY KEY ("id");


--
-- Name: body_site_catalog body_site_catalog_site_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."body_site_catalog"
    ADD CONSTRAINT "body_site_catalog_site_code_key" UNIQUE ("site_code");


--
-- Name: checkup_completions checkup_completions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checkup_completions"
    ADD CONSTRAINT "checkup_completions_pkey" PRIMARY KEY ("id");


--
-- Name: checkup_items checkup_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checkup_items"
    ADD CONSTRAINT "checkup_items_pkey" PRIMARY KEY ("id");


--
-- Name: condition_records condition_records_condition_id_record_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."condition_records"
    ADD CONSTRAINT "condition_records_condition_id_record_id_key" UNIQUE ("condition_id", "record_id");


--
-- Name: condition_records condition_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."condition_records"
    ADD CONSTRAINT "condition_records_pkey" PRIMARY KEY ("id");


--
-- Name: conditions conditions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."conditions"
    ADD CONSTRAINT "conditions_pkey" PRIMARY KEY ("id");


--
-- Name: db_deploy_log db_deploy_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."db_deploy_log"
    ADD CONSTRAINT "db_deploy_log_pkey" PRIMARY KEY ("id");


--
-- Name: finding_type_catalog finding_type_catalog_finding_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."finding_type_catalog"
    ADD CONSTRAINT "finding_type_catalog_finding_code_key" UNIQUE ("finding_code");


--
-- Name: finding_type_catalog finding_type_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."finding_type_catalog"
    ADD CONSTRAINT "finding_type_catalog_pkey" PRIMARY KEY ("id");


--
-- Name: measurement_catalog measurement_catalog_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."measurement_catalog"
    ADD CONSTRAINT "measurement_catalog_code_key" UNIQUE ("code");


--
-- Name: measurement_catalog measurement_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."measurement_catalog"
    ADD CONSTRAINT "measurement_catalog_pkey" PRIMARY KEY ("id");


--
-- Name: measurements measurements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."measurements"
    ADD CONSTRAINT "measurements_pkey" PRIMARY KEY ("id");


--
-- Name: med_dose_events med_dose_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."med_dose_events"
    ADD CONSTRAINT "med_dose_events_pkey" PRIMARY KEY ("id");


--
-- Name: med_inventory_transactions med_inventory_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."med_inventory_transactions"
    ADD CONSTRAINT "med_inventory_transactions_pkey" PRIMARY KEY ("id");


--
-- Name: med_regimens med_regimens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."med_regimens"
    ADD CONSTRAINT "med_regimens_pkey" PRIMARY KEY ("id");


--
-- Name: medical_records medical_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."medical_records"
    ADD CONSTRAINT "medical_records_pkey" PRIMARY KEY ("id");


--
-- Name: money_accounts money_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_accounts"
    ADD CONSTRAINT "money_accounts_pkey" PRIMARY KEY ("id");


--
-- Name: money_cards money_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_cards"
    ADD CONSTRAINT "money_cards_pkey" PRIMARY KEY ("id");


--
-- Name: money_categories money_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_categories"
    ADD CONSTRAINT "money_categories_pkey" PRIMARY KEY ("id");


--
-- Name: money_categories money_categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_categories"
    ADD CONSTRAINT "money_categories_slug_key" UNIQUE ("slug");


--
-- Name: money_import_batch_rows money_import_batch_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_import_batch_rows"
    ADD CONSTRAINT "money_import_batch_rows_pkey" PRIMARY KEY ("id");


--
-- Name: money_import_batches money_import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_import_batches"
    ADD CONSTRAINT "money_import_batches_pkey" PRIMARY KEY ("id");


--
-- Name: money_import_sessions money_import_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_import_sessions"
    ADD CONSTRAINT "money_import_sessions_pkey" PRIMARY KEY ("id");


--
-- Name: money_import_sessions money_import_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_import_sessions"
    ADD CONSTRAINT "money_import_sessions_token_hash_key" UNIQUE ("token_hash");


--
-- Name: money_line_items money_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_line_items"
    ADD CONSTRAINT "money_line_items_pkey" PRIMARY KEY ("id");


--
-- Name: money_transactions money_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_transactions"
    ADD CONSTRAINT "money_transactions_pkey" PRIMARY KEY ("id");


--
-- Name: notification_digests notification_digests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_digests"
    ADD CONSTRAINT "notification_digests_pkey" PRIMARY KEY ("id");


--
-- Name: notification_routing notification_routing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_routing"
    ADD CONSTRAINT "notification_routing_pkey" PRIMARY KEY ("id");


--
-- Name: notification_routing notification_routing_recipient_user_id_person_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_routing"
    ADD CONSTRAINT "notification_routing_recipient_user_id_person_id_key" UNIQUE ("recipient_user_id", "person_id");


--
-- Name: observation_catalog observation_catalog_obs_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."observation_catalog"
    ADD CONSTRAINT "observation_catalog_obs_code_key" UNIQUE ("obs_code");


--
-- Name: observation_catalog observation_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."observation_catalog"
    ADD CONSTRAINT "observation_catalog_pkey" PRIMARY KEY ("id");


--
-- Name: persons persons_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."persons"
    ADD CONSTRAINT "persons_auth_user_id_key" UNIQUE ("auth_user_id");


--
-- Name: persons persons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."persons"
    ADD CONSTRAINT "persons_pkey" PRIMARY KEY ("id");


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");


--
-- Name: record_attachments record_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."record_attachments"
    ADD CONSTRAINT "record_attachments_pkey" PRIMARY KEY ("id");


--
-- Name: record_findings record_findings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."record_findings"
    ADD CONSTRAINT "record_findings_pkey" PRIMARY KEY ("id");


--
-- Name: record_observations record_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."record_observations"
    ADD CONSTRAINT "record_observations_pkey" PRIMARY KEY ("id");


--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("auth_user_id");


--
-- Name: idx_allowed_users_auth_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_allowed_users_auth_user_id" ON "public"."allowed_users" USING "btree" ("auth_user_id");


--
-- Name: idx_allowed_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_allowed_users_email" ON "public"."allowed_users" USING "btree" ("email");


--
-- Name: idx_body_site_catalog_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_body_site_catalog_code" ON "public"."body_site_catalog" USING "btree" ("site_code");


--
-- Name: idx_body_site_catalog_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_body_site_catalog_parent" ON "public"."body_site_catalog" USING "btree" ("parent_site_code");


--
-- Name: idx_body_site_catalog_synonyms_en; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_body_site_catalog_synonyms_en" ON "public"."body_site_catalog" USING "gin" ("synonyms_en");


--
-- Name: idx_body_site_catalog_synonyms_ru; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_body_site_catalog_synonyms_ru" ON "public"."body_site_catalog" USING "gin" ("synonyms_ru");


--
-- Name: idx_checkup_completions_checkup_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_checkup_completions_checkup_item_id" ON "public"."checkup_completions" USING "btree" ("checkup_item_id");


--
-- Name: idx_checkup_completions_done_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_checkup_completions_done_at" ON "public"."checkup_completions" USING "btree" ("done_at");


--
-- Name: idx_checkup_items_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_checkup_items_category" ON "public"."checkup_items" USING "btree" ("category");


--
-- Name: idx_checkup_items_next_due_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_checkup_items_next_due_at" ON "public"."checkup_items" USING "btree" ("next_due_at");


--
-- Name: idx_checkup_items_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_checkup_items_person_id" ON "public"."checkup_items" USING "btree" ("person_id");


--
-- Name: idx_checkup_items_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_checkup_items_status" ON "public"."checkup_items" USING "btree" ("status");


--
-- Name: idx_checkup_items_why_links; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_checkup_items_why_links" ON "public"."checkup_items" USING "gin" ("why_links" "jsonb_path_ops");


--
-- Name: idx_condition_records_condition_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_condition_records_condition_id" ON "public"."condition_records" USING "btree" ("condition_id");


--
-- Name: idx_condition_records_record_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_condition_records_record_id" ON "public"."condition_records" USING "btree" ("record_id");


--
-- Name: idx_conditions_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_conditions_code" ON "public"."conditions" USING "btree" ("code") WHERE ("code" IS NOT NULL);


--
-- Name: idx_conditions_current_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_conditions_current_status" ON "public"."conditions" USING "btree" ("current_status");


--
-- Name: idx_conditions_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_conditions_deleted_at" ON "public"."conditions" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_conditions_name_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_conditions_name_lower" ON "public"."conditions" USING "btree" ("lower"("name"));


--
-- Name: idx_conditions_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_conditions_person_id" ON "public"."conditions" USING "btree" ("person_id");


--
-- Name: idx_finding_type_catalog_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_finding_type_catalog_code" ON "public"."finding_type_catalog" USING "btree" ("finding_code");


--
-- Name: idx_finding_type_catalog_synonyms_en; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_finding_type_catalog_synonyms_en" ON "public"."finding_type_catalog" USING "gin" ("synonyms_en");


--
-- Name: idx_finding_type_catalog_synonyms_ru; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_finding_type_catalog_synonyms_ru" ON "public"."finding_type_catalog" USING "gin" ("synonyms_ru");


--
-- Name: idx_measurement_catalog_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_measurement_catalog_category" ON "public"."measurement_catalog" USING "btree" ("category", "sort_order");


--
-- Name: idx_measurement_catalog_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_measurement_catalog_code" ON "public"."measurement_catalog" USING "btree" ("code");


--
-- Name: idx_measurements_catalog_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_measurements_catalog_id" ON "public"."measurements" USING "btree" ("catalog_id");


--
-- Name: idx_measurements_measured_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_measurements_measured_at" ON "public"."measurements" USING "btree" ("measured_at" DESC);


--
-- Name: idx_measurements_person_catalog; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_measurements_person_catalog" ON "public"."measurements" USING "btree" ("person_id", "catalog_id", "measured_at" DESC);


--
-- Name: idx_measurements_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_measurements_person_id" ON "public"."measurements" USING "btree" ("person_id");


--
-- Name: idx_med_dose_events_actual_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_med_dose_events_actual_at" ON "public"."med_dose_events" USING "btree" ("actual_at");


--
-- Name: idx_med_dose_events_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_med_dose_events_deleted_at" ON "public"."med_dose_events" USING "btree" ("regimen_id") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_med_dose_events_person_actual; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_med_dose_events_person_actual" ON "public"."med_dose_events" USING "btree" ("person_id", "actual_at");


--
-- Name: idx_med_dose_events_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_med_dose_events_person_id" ON "public"."med_dose_events" USING "btree" ("person_id");


--
-- Name: idx_med_dose_events_regimen_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_med_dose_events_regimen_id" ON "public"."med_dose_events" USING "btree" ("regimen_id");


--
-- Name: idx_med_dose_events_regimen_scheduled_minute; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_med_dose_events_regimen_scheduled_minute" ON "public"."med_dose_events" USING "btree" ("regimen_id", "date_trunc"('minute'::"text", ("scheduled_at" AT TIME ZONE 'UTC'::"text"))) WHERE ("status" = ANY (ARRAY['scheduled'::"public"."med_dose_event_status", 'sent'::"public"."med_dose_event_status"]));


--
-- Name: idx_med_dose_events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_med_dose_events_status" ON "public"."med_dose_events" USING "btree" ("status");


--
-- Name: idx_med_inventory_transactions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_med_inventory_transactions_created_at" ON "public"."med_inventory_transactions" USING "btree" ("created_at");


--
-- Name: idx_med_inventory_transactions_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_med_inventory_transactions_event_id" ON "public"."med_inventory_transactions" USING "btree" ("event_id");


--
-- Name: idx_med_inventory_transactions_regimen_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_med_inventory_transactions_regimen_id" ON "public"."med_inventory_transactions" USING "btree" ("regimen_id");


--
-- Name: idx_med_regimens_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_med_regimens_deleted_at" ON "public"."med_regimens" USING "btree" ("person_id") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_med_regimens_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_med_regimens_person_id" ON "public"."med_regimens" USING "btree" ("person_id");


--
-- Name: idx_med_regimens_schedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_med_regimens_schedule" ON "public"."med_regimens" USING "gin" ("schedule" "jsonb_path_ops");


--
-- Name: idx_med_regimens_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_med_regimens_status" ON "public"."med_regimens" USING "btree" ("status");


--
-- Name: idx_medical_records_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_medical_records_created_by" ON "public"."medical_records" USING "btree" ("created_by_user_id");


--
-- Name: idx_medical_records_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_medical_records_person_id" ON "public"."medical_records" USING "btree" ("person_id");


--
-- Name: idx_medical_records_record_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_medical_records_record_date" ON "public"."medical_records" USING "btree" ("record_date");


--
-- Name: idx_medical_records_record_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_medical_records_record_type" ON "public"."medical_records" USING "btree" ("record_type");


--
-- Name: idx_medical_records_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_medical_records_search" ON "public"."medical_records" USING "gin" ("search_vector");


--
-- Name: idx_medical_records_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_medical_records_status" ON "public"."medical_records" USING "btree" ("status");


--
-- Name: idx_money_accounts_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_accounts_is_active" ON "public"."money_accounts" USING "btree" ("is_active");


--
-- Name: idx_money_accounts_owner_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_accounts_owner_person_id" ON "public"."money_accounts" USING "btree" ("owner_person_id");


--
-- Name: idx_money_cards_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_cards_account_id" ON "public"."money_cards" USING "btree" ("account_id");


--
-- Name: idx_money_cards_account_last4; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_money_cards_account_last4" ON "public"."money_cards" USING "btree" ("account_id", "last4");


--
-- Name: idx_money_categories_depth; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_categories_depth" ON "public"."money_categories" USING "btree" ("depth");


--
-- Name: idx_money_categories_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_categories_parent_id" ON "public"."money_categories" USING "btree" ("parent_id");


--
-- Name: idx_money_import_batch_rows_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_import_batch_rows_batch_id" ON "public"."money_import_batch_rows" USING "btree" ("batch_id");


--
-- Name: idx_money_import_batch_rows_ordering; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_import_batch_rows_ordering" ON "public"."money_import_batch_rows" USING "btree" ("batch_id", "source_row_index", "source_line_index", "created_at");


--
-- Name: idx_money_import_batch_rows_parent_row_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_import_batch_rows_parent_row_id" ON "public"."money_import_batch_rows" USING "btree" ("parent_row_id");


--
-- Name: idx_money_import_batches_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_import_batches_created_at" ON "public"."money_import_batches" USING "btree" ("created_at");


--
-- Name: idx_money_import_batches_payer_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_import_batches_payer_person_id" ON "public"."money_import_batches" USING "btree" ("payer_person_id");


--
-- Name: idx_money_import_batches_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_import_batches_session_id" ON "public"."money_import_batches" USING "btree" ("session_id");


--
-- Name: idx_money_import_batches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_import_batches_status" ON "public"."money_import_batches" USING "btree" ("status");


--
-- Name: idx_money_import_sessions_created_by_auth_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_import_sessions_created_by_auth_user_id" ON "public"."money_import_sessions" USING "btree" ("created_by_auth_user_id");


--
-- Name: idx_money_import_sessions_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_import_sessions_expires_at" ON "public"."money_import_sessions" USING "btree" ("expires_at");


--
-- Name: idx_money_import_sessions_payer_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_import_sessions_payer_person_id" ON "public"."money_import_sessions" USING "btree" ("payer_person_id");


--
-- Name: idx_money_line_items_beneficiary_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_line_items_beneficiary_person_id" ON "public"."money_line_items" USING "btree" ("beneficiary_person_id");


--
-- Name: idx_money_line_items_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_line_items_category_id" ON "public"."money_line_items" USING "btree" ("category_id");


--
-- Name: idx_money_line_items_transaction_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_line_items_transaction_id" ON "public"."money_line_items" USING "btree" ("transaction_id");


--
-- Name: idx_money_line_items_tx_import_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_money_line_items_tx_import_hash" ON "public"."money_line_items" USING "btree" ("transaction_id", "import_hash") WHERE ("import_hash" IS NOT NULL);


--
-- Name: idx_money_transactions_account_posted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_transactions_account_posted_at" ON "public"."money_transactions" USING "btree" ("account_id", "posted_at");


--
-- Name: idx_money_transactions_card_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_transactions_card_id" ON "public"."money_transactions" USING "btree" ("card_id");


--
-- Name: idx_money_transactions_dedupe_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_money_transactions_dedupe_hash" ON "public"."money_transactions" USING "btree" ("dedupe_hash");


--
-- Name: idx_money_transactions_payer_posted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_transactions_payer_posted_at" ON "public"."money_transactions" USING "btree" ("payer_person_id", "posted_at");


--
-- Name: idx_money_transactions_posted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_money_transactions_posted_at" ON "public"."money_transactions" USING "btree" ("posted_at");


--
-- Name: idx_money_transactions_source_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_money_transactions_source_external_id" ON "public"."money_transactions" USING "btree" ("source", "external_id") WHERE ("external_id" IS NOT NULL);


--
-- Name: idx_notification_digests_auth_person_type_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_notification_digests_auth_person_type_scheduled" ON "public"."notification_digests" USING "btree" ("auth_user_id", "person_id", "type", "scheduled_at");


--
-- Name: idx_notification_digests_auth_user_type_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_notification_digests_auth_user_type_scheduled" ON "public"."notification_digests" USING "btree" ("auth_user_id", "type", "scheduled_at");


--
-- Name: idx_notification_digests_scheduled_sent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_notification_digests_scheduled_sent" ON "public"."notification_digests" USING "btree" ("scheduled_at", "sent_at");


--
-- Name: idx_notification_digests_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_notification_digests_sent_at" ON "public"."notification_digests" USING "btree" ("sent_at") WHERE ("sent_at" IS NULL);


--
-- Name: idx_notification_digests_window_unsent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_notification_digests_window_unsent" ON "public"."notification_digests" USING "btree" ("auth_user_id", "type") WHERE (("sent_at" IS NULL) AND ("window_start" IS NOT NULL) AND ("window_end" IS NOT NULL));


--
-- Name: idx_notification_routing_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_notification_routing_person" ON "public"."notification_routing" USING "btree" ("person_id");


--
-- Name: idx_notification_routing_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_notification_routing_recipient" ON "public"."notification_routing" USING "btree" ("recipient_user_id");


--
-- Name: idx_observation_catalog_obs_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_observation_catalog_obs_code" ON "public"."observation_catalog" USING "btree" ("obs_code");


--
-- Name: idx_observation_catalog_synonyms_en; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_observation_catalog_synonyms_en" ON "public"."observation_catalog" USING "gin" ("synonyms_en");


--
-- Name: idx_observation_catalog_synonyms_ru; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_observation_catalog_synonyms_ru" ON "public"."observation_catalog" USING "gin" ("synonyms_ru");


--
-- Name: idx_persons_auth_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_persons_auth_user_id" ON "public"."persons" USING "btree" ("auth_user_id");


--
-- Name: idx_persons_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_persons_kind" ON "public"."persons" USING "btree" ("kind");


--
-- Name: idx_push_subscriptions_auth_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_push_subscriptions_auth_user_id" ON "public"."push_subscriptions" USING "btree" ("auth_user_id");


--
-- Name: idx_record_attachments_record_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_record_attachments_record_id" ON "public"."record_attachments" USING "btree" ("record_id");


--
-- Name: idx_record_attachments_sort_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_record_attachments_sort_order" ON "public"."record_attachments" USING "btree" ("record_id", "sort_order");


--
-- Name: idx_record_findings_body_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_record_findings_body_site_id" ON "public"."record_findings" USING "btree" ("body_site_id");


--
-- Name: idx_record_findings_finding_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_record_findings_finding_code" ON "public"."record_findings" USING "btree" ("finding_code");


--
-- Name: idx_record_findings_finding_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_record_findings_finding_date" ON "public"."record_findings" USING "btree" ("finding_date");


--
-- Name: idx_record_findings_finding_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_record_findings_finding_type_id" ON "public"."record_findings" USING "btree" ("finding_type_id");


--
-- Name: idx_record_findings_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_record_findings_person_id" ON "public"."record_findings" USING "btree" ("person_id");


--
-- Name: idx_record_findings_record_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_record_findings_record_id" ON "public"."record_findings" USING "btree" ("record_id");


--
-- Name: idx_record_findings_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_record_findings_severity" ON "public"."record_findings" USING "btree" ("severity");


--
-- Name: idx_record_findings_site_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_record_findings_site_code" ON "public"."record_findings" USING "btree" ("site_code");


--
-- Name: idx_record_observations_catalog_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_record_observations_catalog_id" ON "public"."record_observations" USING "btree" ("catalog_id");


--
-- Name: idx_record_observations_is_applied; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_record_observations_is_applied" ON "public"."record_observations" USING "btree" ("is_applied");


--
-- Name: idx_record_observations_obs_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_record_observations_obs_code" ON "public"."record_observations" USING "btree" ("obs_code");


--
-- Name: idx_record_observations_record_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_record_observations_record_id" ON "public"."record_observations" USING "btree" ("record_id");


--
-- Name: checkup_completions checkup_completion_after_delete_trigger; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: checkup_completions checkup_completion_after_insert_trigger; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: checkup_completions checkup_completion_after_update_trigger; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: checkup_items checkup_item_after_update_trigger; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: checkup_items checkup_item_set_next_due_insert; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: body_site_catalog update_body_site_catalog_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: checkup_items update_checkup_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: conditions update_conditions_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: finding_type_catalog update_finding_type_catalog_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: measurement_catalog update_measurement_catalog_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: measurements update_measurements_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: med_dose_events update_med_dose_events_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: med_regimens update_med_regimens_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: medical_records update_medical_records_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: money_accounts update_money_accounts_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: money_cards update_money_cards_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: money_categories update_money_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: money_line_items update_money_line_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: money_transactions update_money_transactions_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: notification_routing update_notification_routing_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: observation_catalog update_observation_catalog_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: persons update_persons_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: record_findings update_record_findings_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: record_observations update_record_observations_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: user_preferences update_user_preferences_updated_at; Type: TRIGGER; Schema: public; Owner: -
----
-- Name: allowed_users allowed_users_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."allowed_users"
    ADD CONSTRAINT "allowed_users_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: body_site_catalog body_site_catalog_parent_site_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."body_site_catalog"
    ADD CONSTRAINT "body_site_catalog_parent_site_code_fkey" FOREIGN KEY ("parent_site_code") REFERENCES "public"."body_site_catalog"("site_code") ON DELETE SET NULL;


--
-- Name: checkup_completions checkup_completions_checkup_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checkup_completions"
    ADD CONSTRAINT "checkup_completions_checkup_item_id_fkey" FOREIGN KEY ("checkup_item_id") REFERENCES "public"."checkup_items"("id") ON DELETE CASCADE;


--
-- Name: checkup_completions checkup_completions_evidence_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checkup_completions"
    ADD CONSTRAINT "checkup_completions_evidence_record_id_fkey" FOREIGN KEY ("evidence_record_id") REFERENCES "public"."medical_records"("id") ON DELETE SET NULL;


--
-- Name: checkup_items checkup_items_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checkup_items"
    ADD CONSTRAINT "checkup_items_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE;


--
-- Name: condition_records condition_records_condition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."condition_records"
    ADD CONSTRAINT "condition_records_condition_id_fkey" FOREIGN KEY ("condition_id") REFERENCES "public"."conditions"("id") ON DELETE CASCADE;


--
-- Name: condition_records condition_records_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."condition_records"
    ADD CONSTRAINT "condition_records_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "public"."medical_records"("id") ON DELETE CASCADE;


--
-- Name: conditions conditions_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."conditions"
    ADD CONSTRAINT "conditions_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE;


--
-- Name: measurements measurements_catalog_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."measurements"
    ADD CONSTRAINT "measurements_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "public"."measurement_catalog"("id") ON DELETE RESTRICT;


--
-- Name: measurements measurements_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."measurements"
    ADD CONSTRAINT "measurements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: measurements measurements_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."measurements"
    ADD CONSTRAINT "measurements_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE;


--
-- Name: med_dose_events med_dose_events_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."med_dose_events"
    ADD CONSTRAINT "med_dose_events_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE;


--
-- Name: med_dose_events med_dose_events_regimen_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."med_dose_events"
    ADD CONSTRAINT "med_dose_events_regimen_id_fkey" FOREIGN KEY ("regimen_id") REFERENCES "public"."med_regimens"("id") ON DELETE CASCADE;


--
-- Name: med_inventory_transactions med_inventory_transactions_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."med_inventory_transactions"
    ADD CONSTRAINT "med_inventory_transactions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."med_dose_events"("id") ON DELETE SET NULL;


--
-- Name: med_inventory_transactions med_inventory_transactions_regimen_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."med_inventory_transactions"
    ADD CONSTRAINT "med_inventory_transactions_regimen_id_fkey" FOREIGN KEY ("regimen_id") REFERENCES "public"."med_regimens"("id") ON DELETE CASCADE;


--
-- Name: med_regimens med_regimens_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."med_regimens"
    ADD CONSTRAINT "med_regimens_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE;


--
-- Name: medical_records medical_records_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."medical_records"
    ADD CONSTRAINT "medical_records_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: medical_records medical_records_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."medical_records"
    ADD CONSTRAINT "medical_records_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE;


--
-- Name: money_accounts money_accounts_owner_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_accounts"
    ADD CONSTRAINT "money_accounts_owner_person_id_fkey" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE;


--
-- Name: money_cards money_cards_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_cards"
    ADD CONSTRAINT "money_cards_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."money_accounts"("id") ON DELETE CASCADE;


--
-- Name: money_categories money_categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_categories"
    ADD CONSTRAINT "money_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."money_categories"("id") ON DELETE SET NULL;


--
-- Name: money_import_batch_rows money_import_batch_rows_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_import_batch_rows"
    ADD CONSTRAINT "money_import_batch_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."money_import_batches"("id") ON DELETE CASCADE;


--
-- Name: money_import_batch_rows money_import_batch_rows_line_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_import_batch_rows"
    ADD CONSTRAINT "money_import_batch_rows_line_item_id_fkey" FOREIGN KEY ("line_item_id") REFERENCES "public"."money_line_items"("id") ON DELETE SET NULL;


--
-- Name: money_import_batch_rows money_import_batch_rows_parent_row_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_import_batch_rows"
    ADD CONSTRAINT "money_import_batch_rows_parent_row_id_fkey" FOREIGN KEY ("parent_row_id") REFERENCES "public"."money_import_batch_rows"("id") ON DELETE CASCADE;


--
-- Name: money_import_batch_rows money_import_batch_rows_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_import_batch_rows"
    ADD CONSTRAINT "money_import_batch_rows_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."money_transactions"("id") ON DELETE SET NULL;


--
-- Name: money_import_batches money_import_batches_payer_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_import_batches"
    ADD CONSTRAINT "money_import_batches_payer_person_id_fkey" FOREIGN KEY ("payer_person_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE;


--
-- Name: money_import_batches money_import_batches_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_import_batches"
    ADD CONSTRAINT "money_import_batches_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."money_import_sessions"("id") ON DELETE SET NULL;


--
-- Name: money_import_sessions money_import_sessions_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_import_sessions"
    ADD CONSTRAINT "money_import_sessions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."money_import_batches"("id") ON DELETE SET NULL;


--
-- Name: money_import_sessions money_import_sessions_payer_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_import_sessions"
    ADD CONSTRAINT "money_import_sessions_payer_person_id_fkey" FOREIGN KEY ("payer_person_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE;


--
-- Name: money_line_items money_line_items_beneficiary_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_line_items"
    ADD CONSTRAINT "money_line_items_beneficiary_person_id_fkey" FOREIGN KEY ("beneficiary_person_id") REFERENCES "public"."persons"("id") ON DELETE SET NULL;


--
-- Name: money_line_items money_line_items_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_line_items"
    ADD CONSTRAINT "money_line_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."money_categories"("id") ON DELETE SET NULL;


--
-- Name: money_line_items money_line_items_related_line_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_line_items"
    ADD CONSTRAINT "money_line_items_related_line_item_id_fkey" FOREIGN KEY ("related_line_item_id") REFERENCES "public"."money_line_items"("id") ON DELETE SET NULL;


--
-- Name: money_line_items money_line_items_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_line_items"
    ADD CONSTRAINT "money_line_items_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."money_transactions"("id") ON DELETE CASCADE;


--
-- Name: money_transactions money_transactions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_transactions"
    ADD CONSTRAINT "money_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."money_accounts"("id") ON DELETE CASCADE;


--
-- Name: money_transactions money_transactions_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_transactions"
    ADD CONSTRAINT "money_transactions_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."money_cards"("id") ON DELETE SET NULL;


--
-- Name: money_transactions money_transactions_payer_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."money_transactions"
    ADD CONSTRAINT "money_transactions_payer_person_id_fkey" FOREIGN KEY ("payer_person_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE;


--
-- Name: notification_digests notification_digests_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_digests"
    ADD CONSTRAINT "notification_digests_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: notification_digests notification_digests_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_digests"
    ADD CONSTRAINT "notification_digests_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE;


--
-- Name: notification_routing notification_routing_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_routing"
    ADD CONSTRAINT "notification_routing_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE;


--
-- Name: notification_routing notification_routing_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_routing"
    ADD CONSTRAINT "notification_routing_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: persons persons_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."persons"
    ADD CONSTRAINT "persons_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: push_subscriptions push_subscriptions_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: record_attachments record_attachments_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."record_attachments"
    ADD CONSTRAINT "record_attachments_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "public"."medical_records"("id") ON DELETE CASCADE;


--
-- Name: record_findings record_findings_body_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."record_findings"
    ADD CONSTRAINT "record_findings_body_site_id_fkey" FOREIGN KEY ("body_site_id") REFERENCES "public"."body_site_catalog"("id") ON DELETE SET NULL;


--
-- Name: record_findings record_findings_finding_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."record_findings"
    ADD CONSTRAINT "record_findings_finding_type_id_fkey" FOREIGN KEY ("finding_type_id") REFERENCES "public"."finding_type_catalog"("id") ON DELETE SET NULL;


--
-- Name: record_findings record_findings_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."record_findings"
    ADD CONSTRAINT "record_findings_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE;


--
-- Name: record_findings record_findings_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."record_findings"
    ADD CONSTRAINT "record_findings_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "public"."medical_records"("id") ON DELETE CASCADE;


--
-- Name: record_observations record_observations_catalog_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."record_observations"
    ADD CONSTRAINT "record_observations_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "public"."observation_catalog"("id") ON DELETE SET NULL;


--
-- Name: record_observations record_observations_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."record_observations"
    ADD CONSTRAINT "record_observations_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "public"."medical_records"("id") ON DELETE CASCADE;


--
-- Name: user_preferences user_preferences_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--
