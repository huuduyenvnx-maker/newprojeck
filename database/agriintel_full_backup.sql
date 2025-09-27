--
-- PostgreSQL database dump
--

-- Dumped from database version 16.9 (63f4182)
-- Dumped by pg_dump version 16.9

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: neondb_owner
--

CREATE SCHEMA auth;


ALTER SCHEMA auth OWNER TO neondb_owner;

--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: neondb_owner
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE 
    WHEN current_setting('request.jwt.claims', true) IS NOT NULL AND current_setting('request.jwt.claims', true) != ''
    THEN (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
    WHEN current_setting('request.jwt.sub', true) IS NOT NULL AND current_setting('request.jwt.sub', true) != ''
    THEN current_setting('request.jwt.sub', true)::uuid
    ELSE NULL 
  END;
$$;


ALTER FUNCTION auth.uid() OWNER TO neondb_owner;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agreement_analysis; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.agreement_analysis (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    ccs_id character varying NOT NULL,
    openai_verification_id character varying,
    gemini_verification_id character varying,
    semantic_similarity numeric(5,4) NOT NULL,
    price_variance numeric(5,4) NOT NULL,
    trend_alignment numeric(5,4) NOT NULL,
    confidence_overlap numeric(5,4) NOT NULL,
    analysis_method text DEFAULT 'embedding_cosine'::text NOT NULL,
    embedding_model text DEFAULT 'text-embedding-3-small'::text NOT NULL,
    analysis_details jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    coop_id character varying
);


ALTER TABLE public.agreement_analysis OWNER TO neondb_owner;

--
-- Name: alerts; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.alerts (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    commodity_id character varying,
    region_id character varying,
    severity text DEFAULT 'medium'::text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    data jsonb,
    acknowledged boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    coop_id character varying NOT NULL
);


ALTER TABLE public.alerts OWNER TO neondb_owner;

--
-- Name: commodities; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.commodities (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    unit text DEFAULT 'USD/ton'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    slug text NOT NULL
);


ALTER TABLE public.commodities OWNER TO neondb_owner;

--
-- Name: composite_confidence_scores; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.composite_confidence_scores (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    forecast_run_id character varying NOT NULL,
    forecast_30d_id character varying,
    commodity_id character varying NOT NULL,
    region_id character varying NOT NULL,
    composite_score numeric(5,2) NOT NULL,
    agreement_score numeric(5,2) NOT NULL,
    evidence_score numeric(5,2) NOT NULL,
    source_credibility_score numeric(5,2) NOT NULL,
    temporal_consistency_score numeric(5,2) NOT NULL,
    model_confidence_score numeric(5,2) NOT NULL,
    weights jsonb NOT NULL,
    commodity_adjustment numeric(4,3) DEFAULT 1.0 NOT NULL,
    seasonal_adjustment numeric(4,3) DEFAULT 1.0 NOT NULL,
    regional_adjustment numeric(4,3) DEFAULT 1.0 NOT NULL,
    currency_volatility_adjustment numeric(4,3) DEFAULT 1.0 NOT NULL,
    calculation_details jsonb NOT NULL,
    version text DEFAULT '1.0'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    coop_id character varying
);


ALTER TABLE public.composite_confidence_scores OWNER TO neondb_owner;

--
-- Name: cooperative_members; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.cooperative_members (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    coop_id character varying NOT NULL,
    user_id character varying NOT NULL,
    role text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    joined_at timestamp without time zone DEFAULT now(),
    invited_by character varying
);


ALTER TABLE public.cooperative_members OWNER TO neondb_owner;

--
-- Name: cooperatives; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.cooperatives (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.cooperatives OWNER TO neondb_owner;

--
-- Name: evidence; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.evidence (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    source_id character varying,
    commodity_id character varying,
    region_id character varying,
    forecast_id character varying,
    verification_id character varying,
    title text NOT NULL,
    description text NOT NULL,
    impact text NOT NULL,
    confidence numeric(3,2) NOT NULL,
    relevance_score numeric(3,2) NOT NULL,
    url text,
    published_at timestamp without time zone,
    valid_from timestamp without time zone,
    valid_to timestamp without time zone,
    tags jsonb,
    raw_content jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    coop_id character varying
);


ALTER TABLE public.evidence OWNER TO neondb_owner;

--
-- Name: export_audit; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.export_audit (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    coop_id character varying NOT NULL,
    user_id character varying NOT NULL,
    export_type text NOT NULL,
    summary text NOT NULL,
    record_counts jsonb NOT NULL,
    filters jsonb NOT NULL,
    file_format text NOT NULL,
    file_size integer,
    ip_address text,
    user_agent text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.export_audit OWNER TO neondb_owner;

--
-- Name: forecast_runs; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.forecast_runs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    commodity_id character varying NOT NULL,
    region_id character varying NOT NULL,
    run_date timestamp without time zone NOT NULL,
    horizon integer DEFAULT 30 NOT NULL,
    model text NOT NULL,
    model_version text NOT NULL,
    parameters jsonb,
    status text DEFAULT 'running'::text NOT NULL,
    started_at timestamp without time zone DEFAULT now(),
    completed_at timestamp without time zone,
    error_message text,
    metrics jsonb,
    created_at timestamp without time zone DEFAULT now(),
    coop_id character varying
);


ALTER TABLE public.forecast_runs OWNER TO neondb_owner;

--
-- Name: forecasts; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.forecasts (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    commodity_id character varying NOT NULL,
    region_id character varying NOT NULL,
    forecast_date timestamp without time zone NOT NULL,
    horizon integer DEFAULT 30 NOT NULL,
    method text DEFAULT 'ensemble'::text NOT NULL,
    predictions jsonb NOT NULL,
    metrics jsonb NOT NULL,
    model_version text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    coop_id character varying
);


ALTER TABLE public.forecasts OWNER TO neondb_owner;

--
-- Name: forecasts_30d; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.forecasts_30d (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    forecast_run_id character varying NOT NULL,
    commodity_id character varying NOT NULL,
    region_id character varying NOT NULL,
    forecast_date timestamp without time zone NOT NULL,
    target_date timestamp without time zone NOT NULL,
    days_ahead integer NOT NULL,
    median numeric(10,2) NOT NULL,
    q10 numeric(10,2) NOT NULL,
    q25 numeric(10,2) NOT NULL,
    q75 numeric(10,2) NOT NULL,
    q90 numeric(10,2) NOT NULL,
    confidence numeric(3,2) NOT NULL,
    trend text NOT NULL,
    volatility numeric(5,4) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    coop_id character varying
);


ALTER TABLE public.forecasts_30d OWNER TO neondb_owner;

--
-- Name: fx_rates; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.fx_rates (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    base_currency text NOT NULL,
    target_currency text NOT NULL,
    date timestamp without time zone NOT NULL,
    rate numeric(12,6) NOT NULL,
    source_id character varying,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.fx_rates OWNER TO neondb_owner;

--
-- Name: llm_verifications; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.llm_verifications (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    forecast_id character varying NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    prompt text NOT NULL,
    response text NOT NULL,
    confidence numeric(3,2) NOT NULL,
    metadata jsonb,
    verified boolean NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    coop_id character varying,
    forecast_30d_id character varying
);


ALTER TABLE public.llm_verifications OWNER TO neondb_owner;

--
-- Name: price_data; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.price_data (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    commodity_id character varying NOT NULL,
    region_id character varying NOT NULL,
    date timestamp without time zone NOT NULL,
    price numeric(10,2) NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    source text NOT NULL,
    quality_score numeric(3,2) DEFAULT 1.0 NOT NULL,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now(),
    coop_id character varying
);


ALTER TABLE public.price_data OWNER TO neondb_owner;

--
-- Name: prices_raw; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.prices_raw (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    source_id character varying NOT NULL,
    commodity_id character varying NOT NULL,
    region_id character varying NOT NULL,
    date timestamp without time zone NOT NULL,
    price numeric(10,2) NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    volume numeric(12,2),
    unit text NOT NULL,
    raw_data jsonb,
    is_processed boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    evidence_urls jsonb,
    source_type text DEFAULT 'api'::text NOT NULL,
    page_hashes jsonb,
    aggregation_metadata jsonb,
    coop_id character varying
);


ALTER TABLE public.prices_raw OWNER TO neondb_owner;

--
-- Name: prices_verified; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.prices_verified (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    prices_raw_id character varying NOT NULL,
    source_id character varying NOT NULL,
    commodity_id character varying NOT NULL,
    region_id character varying NOT NULL,
    date timestamp without time zone NOT NULL,
    price numeric(10,2) NOT NULL,
    price_usd numeric(10,2) NOT NULL,
    currency text NOT NULL,
    volume numeric(12,2),
    quality_score numeric(3,2) DEFAULT 1.0 NOT NULL,
    verification_method text NOT NULL,
    outlier_flag boolean DEFAULT false NOT NULL,
    adjustments jsonb,
    verified_by character varying,
    verified_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now(),
    openai_score numeric(3,2),
    gemini_score numeric(3,2),
    consensus_score numeric(3,2),
    agreement_level text,
    verification_evidence jsonb,
    coop_id character varying
);


ALTER TABLE public.prices_verified OWNER TO neondb_owner;

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.profiles (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    default_coop_id character varying,
    full_name text,
    phone_number text,
    preferred_language text DEFAULT 'vi'::text NOT NULL,
    timezone text DEFAULT 'Asia/Ho_Chi_Minh'::text NOT NULL,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.profiles OWNER TO neondb_owner;

--
-- Name: quality_gates; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.quality_gates (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    ccs_id character varying NOT NULL,
    forecast_run_id character varying NOT NULL,
    gate_status text NOT NULL,
    confidence_level text NOT NULL,
    threshold numeric(5,2) NOT NULL,
    publish_decision text NOT NULL,
    published_at timestamp without time zone,
    manual_override boolean DEFAULT false NOT NULL,
    override_reason text,
    override_by character varying,
    override_at timestamp without time zone,
    ui_indicator text NOT NULL,
    warning_message text,
    quality_metrics jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    coop_id character varying
);


ALTER TABLE public.quality_gates OWNER TO neondb_owner;

--
-- Name: regions; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.regions (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    country text DEFAULT 'Vietnam'::text NOT NULL,
    timezone text DEFAULT 'Asia/Ho_Chi_Minh'::text NOT NULL
);


ALTER TABLE public.regions OWNER TO neondb_owner;

--
-- Name: roles; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.roles (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    display_name text NOT NULL,
    description text,
    permissions jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.roles OWNER TO neondb_owner;

--
-- Name: session; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.session (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


ALTER TABLE public.session OWNER TO neondb_owner;

--
-- Name: sources; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.sources (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    url text,
    frequency text DEFAULT 'daily'::text NOT NULL,
    reliability numeric(3,2) DEFAULT 1.0 NOT NULL,
    api_key text,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb,
    last_sync timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    coop_id character varying
);


ALTER TABLE public.sources OWNER TO neondb_owner;

--
-- Name: trading_recommendations; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.trading_recommendations (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    forecast_id character varying NOT NULL,
    action text NOT NULL,
    confidence numeric(3,2) NOT NULL,
    entry_price numeric(10,2),
    target_price numeric(10,2),
    stop_loss numeric(10,2),
    risk_level text NOT NULL,
    reasoning text NOT NULL,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now(),
    coop_id character varying
);


ALTER TABLE public.trading_recommendations OWNER TO neondb_owner;

--
-- Name: users; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.users (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    username text NOT NULL,
    password text NOT NULL
);


ALTER TABLE public.users OWNER TO neondb_owner;

--
-- Data for Name: agreement_analysis; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.agreement_analysis (id, ccs_id, openai_verification_id, gemini_verification_id, semantic_similarity, price_variance, trend_alignment, confidence_overlap, analysis_method, embedding_model, analysis_details, created_at, coop_id) FROM stdin;
\.


--
-- Data for Name: alerts; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.alerts (id, type, commodity_id, region_id, severity, title, message, data, acknowledged, created_at, coop_id) FROM stdin;
d3d8ff2f-bd76-4294-a0f5-12dc337d8f28	model_update	\N	\N	high	Ensemble Model Performance Update	The forecasting model has been updated to version 1.2.0 with improved PICP coverage (94.2%) and enhanced dual-LLM verification system.	{"version": "1.2.0", "features": ["dual_llm", "ensemble_optimization"], "picp_improvement": 0.038}	t	2025-09-22 15:21:35.122952	9013faae-563e-4ffe-bf60-099f86c9c5ff
e5690010-ac2a-4407-be89-f034d5dcd394	price_anomaly	7488405f-55b6-4513-bdb5-004b6c33f016	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	medium	Black Pepper Price Volatility Alert	Black pepper prices have shown unusual volatility over the past 2 weeks, fluctuating between $6,420-$6,750 per ton. This may indicate supply chain disruptions or weather-related concerns.	{"confidence": 0.91, "price_change": -4.2, "volatility_score": 0.78}	t	2025-09-22 15:21:35.122952	9013faae-563e-4ffe-bf60-099f86c9c5ff
ea6d932d-681f-4846-8577-abd2af8615df	quality_warning	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	low	Rice Quality Score Declining	Quality scores for Jasmine Rice have dipped below 95% in recent data points. Consider verifying data sources and market conditions.	{"threshold": 0.95, "avg_quality": 0.93, "data_points": 5}	t	2025-09-22 15:21:35.122952	9013faae-563e-4ffe-bf60-099f86c9c5ff
\.


--
-- Data for Name: commodities; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.commodities (id, name, category, unit, created_at, slug) FROM stdin;
d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	Gạo trắng 5% tấm	agricultural	USD/t	2025-09-22 15:19:43.180933	rice_5pct
82f18091-2d07-43d6-9653-bf7708f1948e	Cà phê Robusta FAQ	agricultural	USD/t	2025-09-22 15:19:43.180933	coffee_robusta
cb4683a6-6b47-49e6-8b83-4fce571e026e	Cao su TSR20	agricultural	USD/t	2025-09-22 15:19:43.180933	rubber_tsr20
7488405f-55b6-4513-bdb5-004b6c33f016	Tiêu đen FAQ	agricultural	USD/t	2025-09-22 15:19:43.180933	pepper_black
8f41e7d6-83ab-4803-90d4-c1f556beab03	Ngô vàng	agricultural	USD/t	2025-09-23 15:28:24.803412	corn_maize
83507dea-8f57-49b2-aa97-315c67dc2896	Đậu tương	agricultural	USD/t	2025-09-23 15:28:24.803412	soybean
a5d99ad6-9627-4a02-a1e2-36d8827e1c76	Lúa mì	agricultural	USD/t	2025-09-23 15:28:24.803412	wheat
1bacc1f8-71f2-435f-aef2-993ab764c9a3	Đường thô #11	agricultural	USD/t	2025-09-23 15:28:24.803412	sugar_raw11
4babd902-59ec-4473-8160-8fed5977b94a	Sầu riêng tươi	agricultural	USD/t	2025-09-23 17:12:01.637625	durian_fresh
3e8d6e6d-5890-4534-92a1-0a518559abd8	Sắn lát	agricultural	USD/t	2025-09-23 15:28:24.803412	cassava_chips
1051d6c3-baf4-40b2-b63f-7c086f473573	Urea 46%N	fertilizer	USD/t	2025-09-22 15:19:43.180933	urea_46n
c1a62c40-bf50-4978-a702-a8702e1bfdc7	DAP 18-46-0	fertilizer	USD/t	2025-09-22 15:19:43.180933	dap_18_46_0
355d10c2-09fa-44e5-9cbd-492ed462fda9	NPK 16-16-8	fertilizer	USD/t	2025-09-22 15:19:43.180933	npk_16_16_8
de46d538-6597-4326-9e33-9759389d8fbc	Potash MOP KCl 60%	fertilizer	USD/t	2025-09-22 15:19:43.180933	mop_kcl_60
df81e93e-8d45-4d70-9ddd-499d70289842	TSP 46% P2O5	fertilizer	USD/t	2025-09-22 15:19:43.180933	tsp_46
\.


--
-- Data for Name: composite_confidence_scores; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.composite_confidence_scores (id, forecast_run_id, forecast_30d_id, commodity_id, region_id, composite_score, agreement_score, evidence_score, source_credibility_score, temporal_consistency_score, model_confidence_score, weights, commodity_adjustment, seasonal_adjustment, regional_adjustment, currency_volatility_adjustment, calculation_details, version, created_at, coop_id) FROM stdin;
\.


--
-- Data for Name: cooperative_members; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.cooperative_members (id, coop_id, user_id, role, active, joined_at, invited_by) FROM stdin;
\.


--
-- Data for Name: cooperatives; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.cooperatives (id, name, slug, active, metadata, created_at) FROM stdin;
9013faae-563e-4ffe-bf60-099f86c9c5ff	Hợp tác xã Mặc định	default-coop	t	{"migration": true, "description": "Hợp tác xã mặc định cho dữ liệu hiện có"}	2025-09-22 23:13:07.671621
\.


--
-- Data for Name: evidence; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.evidence (id, type, source_id, commodity_id, region_id, forecast_id, verification_id, title, description, impact, confidence, relevance_score, url, published_at, valid_from, valid_to, tags, raw_content, is_active, created_at, coop_id) FROM stdin;
\.


--
-- Data for Name: export_audit; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.export_audit (id, coop_id, user_id, export_type, summary, record_counts, filters, file_format, file_size, ip_address, user_agent, created_at) FROM stdin;
\.


--
-- Data for Name: forecast_runs; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.forecast_runs (id, commodity_id, region_id, run_date, horizon, model, model_version, parameters, status, started_at, completed_at, error_message, metrics, created_at, coop_id) FROM stdin;
\.


--
-- Data for Name: forecasts; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.forecasts (id, commodity_id, region_id, forecast_date, horizon, method, predictions, metrics, model_version, is_active, created_at, coop_id) FROM stdin;
9d17896a-72dc-4851-8154-b210da33322a	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-22 15:26:46.084	30	ensemble_lgb_arima_ets	[{"q10": 2387.16, "q90": 2931.83, "date": "2025-09-23", "median": 2659.49, "confidence": 0.89}, {"q10": 2474.95, "q90": 3039.65, "date": "2025-09-24", "median": 2757.3, "confidence": 0.88}, {"q10": 2433.48, "q90": 2988.71, "date": "2025-09-25", "median": 2711.09, "confidence": 0.87}, {"q10": 2377.15, "q90": 2919.53, "date": "2025-09-26", "median": 2648.34, "confidence": 0.86}, {"q10": 2375.29, "q90": 2917.25, "date": "2025-09-27", "median": 2646.27, "confidence": 0.85}, {"q10": 2330.73, "q90": 2862.52, "date": "2025-09-28", "median": 2596.62, "confidence": 0.84}, {"q10": 2343.07, "q90": 2877.67, "date": "2025-09-29", "median": 2610.37, "confidence": 0.83}, {"q10": 2485.03, "q90": 3052.03, "date": "2025-09-30", "median": 2768.53, "confidence": 0.82}, {"q10": 2520.95, "q90": 3096.14, "date": "2025-10-01", "median": 2808.54, "confidence": 0.81}, {"q10": 2454.06, "q90": 3013.99, "date": "2025-10-02", "median": 2734.03, "confidence": 0.8}, {"q10": 2454.27, "q90": 3014.24, "date": "2025-10-03", "median": 2734.26, "confidence": 0.79}, {"q10": 2421.02, "q90": 2973.41, "date": "2025-10-04", "median": 2697.21, "confidence": 0.78}, {"q10": 2345.91, "q90": 2881.16, "date": "2025-10-05", "median": 2613.54, "confidence": 0.77}, {"q10": 2535.98, "q90": 3114.6, "date": "2025-10-06", "median": 2825.29, "confidence": 0.76}, {"q10": 2408.63, "q90": 2958.19, "date": "2025-10-07", "median": 2683.41, "confidence": 0.75}, {"q10": 2343.07, "q90": 2877.68, "date": "2025-10-08", "median": 2610.38, "confidence": 0.74}, {"q10": 2505.93, "q90": 3077.69, "date": "2025-10-09", "median": 2791.81, "confidence": 0.73}, {"q10": 2447.45, "q90": 3005.87, "date": "2025-10-10", "median": 2726.66, "confidence": 0.72}, {"q10": 2421.37, "q90": 2973.84, "date": "2025-10-11", "median": 2697.6, "confidence": 0.71}, {"q10": 2438.08, "q90": 2994.37, "date": "2025-10-12", "median": 2716.22, "confidence": 0.7}, {"q10": 2314.62, "q90": 2842.73, "date": "2025-10-13", "median": 2578.68, "confidence": 0.69}, {"q10": 2436.69, "q90": 2992.65, "date": "2025-10-14", "median": 2714.67, "confidence": 0.68}, {"q10": 2351.79, "q90": 2888.38, "date": "2025-10-15", "median": 2620.09, "confidence": 0.67}, {"q10": 2422.31, "q90": 2975, "date": "2025-10-16", "median": 2698.65, "confidence": 0.66}, {"q10": 2281.68, "q90": 2802.27, "date": "2025-10-17", "median": 2541.97, "confidence": 0.65}, {"q10": 2413.14, "q90": 2963.73, "date": "2025-10-18", "median": 2688.43, "confidence": 0.64}, {"q10": 2361.98, "q90": 2900.9, "date": "2025-10-19", "median": 2631.44, "confidence": 0.63}, {"q10": 2376.92, "q90": 2919.25, "date": "2025-10-20", "median": 2648.08, "confidence": 0.62}, {"q10": 2307.53, "q90": 2834.02, "date": "2025-10-21", "median": 2570.78, "confidence": 0.61}, {"q10": 2379.57, "q90": 2922.5, "date": "2025-10-22", "median": 2651.04, "confidence": 0.6}]	{"fqs": 92.3, "mase": 0.84, "picp": 94.7, "smape": 8.7, "coverage": 95.2}	v1.2.0	f	2025-09-22 15:26:46.119239	\N
be299cc6-e62f-42fd-88e5-dea93b0049a2	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-22 15:30:05.594	15	ensemble_lgb_arima_ets	[{"q10": 2427.52, "q90": 2981.39, "date": "2025-09-23", "median": 2704.45, "confidence": 0.88}, {"q10": 2302.65, "q90": 2828.03, "date": "2025-09-24", "median": 2565.34, "confidence": 0.86}, {"q10": 2302.54, "q90": 2827.9, "date": "2025-09-25", "median": 2565.22, "confidence": 0.84}, {"q10": 2341.1, "q90": 2875.26, "date": "2025-09-26", "median": 2608.18, "confidence": 0.82}, {"q10": 2362.07, "q90": 2901.01, "date": "2025-09-27", "median": 2631.54, "confidence": 0.8}, {"q10": 2516.88, "q90": 3091.15, "date": "2025-09-28", "median": 2804.02, "confidence": 0.78}, {"q10": 2351.16, "q90": 2887.6, "date": "2025-09-29", "median": 2619.38, "confidence": 0.76}, {"q10": 2320.67, "q90": 2850.16, "date": "2025-09-30", "median": 2585.41, "confidence": 0.74}, {"q10": 2473.81, "q90": 3038.24, "date": "2025-10-01", "median": 2756.02, "confidence": 0.72}, {"q10": 2547.52, "q90": 3128.78, "date": "2025-10-02", "median": 2838.15, "confidence": 0.7}, {"q10": 2516.72, "q90": 3090.95, "date": "2025-10-03", "median": 2803.84, "confidence": 0.68}, {"q10": 2332.83, "q90": 2865.09, "date": "2025-10-04", "median": 2598.96, "confidence": 0.66}, {"q10": 2380.41, "q90": 2923.54, "date": "2025-10-05", "median": 2651.98, "confidence": 0.64}, {"q10": 2492.45, "q90": 3061.14, "date": "2025-10-06", "median": 2776.79, "confidence": 0.62}, {"q10": 2434.14, "q90": 2989.53, "date": "2025-10-07", "median": 2711.83, "confidence": 0.6}]	{"fqs": 92.3, "mase": 0.84, "picp": 94.7, "smape": 8.7, "coverage": 95.2}	v1.2.0	t	2025-09-22 15:30:05.628389	\N
1ebead52-5966-44bc-8871-dcc238378e63	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-22 15:21:04.728584	30	ensemble	[{"q10": 560.2, "q90": 592.8, "date": "2024-09-23", "median": 575.5, "confidence": 0.87}, {"q10": 556.1, "q90": 590.4, "date": "2024-09-30", "median": 572.3, "confidence": 0.85}, {"q10": 552.8, "q90": 588.2, "date": "2024-10-07", "median": 569.8, "confidence": 0.83}, {"q10": 549.5, "q90": 586.1, "date": "2024-10-14", "median": 567.2, "confidence": 0.81}, {"q10": 546.8, "q90": 584.5, "date": "2024-10-21", "median": 565.1, "confidence": 0.79}]	{"mase": 0.85, "picp": 0.94, "smape": 12.3, "coverage": 0.89}	AgriIntel-v1.2.0	f	2025-09-22 15:21:04.728584	\N
604d6904-ddc6-4407-873c-c8250c7843cc	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-22 15:35:38.489	30	ensemble_lgb_arima_ets	[{"q10": 530.18, "q90": 651.15, "date": "2025-09-23", "median": 590.66, "confidence": 0.89}, {"q10": 505.52, "q90": 620.86, "date": "2025-09-24", "median": 563.19, "confidence": 0.88}, {"q10": 514.48, "q90": 631.86, "date": "2025-09-25", "median": 573.17, "confidence": 0.87}, {"q10": 501.47, "q90": 615.89, "date": "2025-09-26", "median": 558.68, "confidence": 0.86}, {"q10": 539.9, "q90": 663.08, "date": "2025-09-27", "median": 601.49, "confidence": 0.85}, {"q10": 506.15, "q90": 621.64, "date": "2025-09-28", "median": 563.89, "confidence": 0.84}, {"q10": 512.98, "q90": 630.02, "date": "2025-09-29", "median": 571.5, "confidence": 0.83}, {"q10": 552.44, "q90": 678.49, "date": "2025-09-30", "median": 615.47, "confidence": 0.82}, {"q10": 545.37, "q90": 669.8, "date": "2025-10-01", "median": 607.59, "confidence": 0.81}, {"q10": 513.42, "q90": 630.56, "date": "2025-10-02", "median": 571.99, "confidence": 0.8}, {"q10": 509.45, "q90": 625.69, "date": "2025-10-03", "median": 567.57, "confidence": 0.79}, {"q10": 548.9, "q90": 674.14, "date": "2025-10-04", "median": 611.52, "confidence": 0.78}, {"q10": 554.25, "q90": 680.71, "date": "2025-10-05", "median": 617.48, "confidence": 0.77}, {"q10": 524.81, "q90": 644.55, "date": "2025-10-06", "median": 584.68, "confidence": 0.76}, {"q10": 510.48, "q90": 626.95, "date": "2025-10-07", "median": 568.71, "confidence": 0.75}, {"q10": 520.68, "q90": 639.48, "date": "2025-10-08", "median": 580.08, "confidence": 0.74}, {"q10": 507.15, "q90": 622.86, "date": "2025-10-09", "median": 565, "confidence": 0.73}, {"q10": 540.26, "q90": 663.53, "date": "2025-10-10", "median": 601.89, "confidence": 0.72}, {"q10": 503.84, "q90": 618.8, "date": "2025-10-11", "median": 561.32, "confidence": 0.71}, {"q10": 508.94, "q90": 625.06, "date": "2025-10-12", "median": 567, "confidence": 0.7}, {"q10": 535.41, "q90": 657.57, "date": "2025-10-13", "median": 596.49, "confidence": 0.69}, {"q10": 541.06, "q90": 664.51, "date": "2025-10-14", "median": 602.79, "confidence": 0.68}, {"q10": 540.44, "q90": 663.75, "date": "2025-10-15", "median": 602.09, "confidence": 0.67}, {"q10": 496.89, "q90": 610.26, "date": "2025-10-16", "median": 553.57, "confidence": 0.66}, {"q10": 524.01, "q90": 643.57, "date": "2025-10-17", "median": 583.79, "confidence": 0.65}, {"q10": 525.58, "q90": 645.5, "date": "2025-10-18", "median": 585.54, "confidence": 0.64}, {"q10": 530.19, "q90": 651.16, "date": "2025-10-19", "median": 590.67, "confidence": 0.63}, {"q10": 518.33, "q90": 636.59, "date": "2025-10-20", "median": 577.46, "confidence": 0.62}, {"q10": 521.1, "q90": 639.99, "date": "2025-10-21", "median": 580.55, "confidence": 0.61}, {"q10": 530.27, "q90": 651.26, "date": "2025-10-22", "median": 590.77, "confidence": 0.6}]	{"fqs": 92.3, "mase": 0.84, "picp": 94.7, "smape": 8.7, "coverage": 95.2}	v1.2.0	f	2025-09-22 15:35:38.52414	\N
56db8583-575d-4c08-8b8e-1ff5b0763aad	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-22 15:37:16.992	30	ensemble_lgb_arima_ets	[{"q10": 539.57, "q90": 662.68, "date": "2025-09-23", "median": 601.13, "confidence": 0.89}, {"q10": 529.28, "q90": 650.04, "date": "2025-09-24", "median": 589.66, "confidence": 0.88}, {"q10": 497.57, "q90": 611.1, "date": "2025-09-25", "median": 554.33, "confidence": 0.87}, {"q10": 516.33, "q90": 634.13, "date": "2025-09-26", "median": 575.23, "confidence": 0.86}, {"q10": 550.97, "q90": 676.68, "date": "2025-09-27", "median": 613.82, "confidence": 0.85}, {"q10": 533.04, "q90": 654.66, "date": "2025-09-28", "median": 593.85, "confidence": 0.84}, {"q10": 533.24, "q90": 654.91, "date": "2025-09-29", "median": 594.08, "confidence": 0.83}, {"q10": 553.9, "q90": 680.28, "date": "2025-09-30", "median": 617.09, "confidence": 0.82}, {"q10": 518.99, "q90": 637.4, "date": "2025-10-01", "median": 578.2, "confidence": 0.81}, {"q10": 509.91, "q90": 626.25, "date": "2025-10-02", "median": 568.08, "confidence": 0.8}, {"q10": 521.28, "q90": 640.22, "date": "2025-10-03", "median": 580.75, "confidence": 0.79}, {"q10": 530.27, "q90": 651.25, "date": "2025-10-04", "median": 590.76, "confidence": 0.78}, {"q10": 520.98, "q90": 639.85, "date": "2025-10-05", "median": 580.41, "confidence": 0.77}, {"q10": 522.08, "q90": 641.2, "date": "2025-10-06", "median": 581.64, "confidence": 0.76}, {"q10": 529.71, "q90": 650.58, "date": "2025-10-07", "median": 590.15, "confidence": 0.75}, {"q10": 506.65, "q90": 622.25, "date": "2025-10-08", "median": 564.45, "confidence": 0.74}, {"q10": 509.56, "q90": 625.83, "date": "2025-10-09", "median": 567.69, "confidence": 0.73}, {"q10": 541.53, "q90": 665.09, "date": "2025-10-10", "median": 603.31, "confidence": 0.72}, {"q10": 514.11, "q90": 631.42, "date": "2025-10-11", "median": 572.77, "confidence": 0.71}, {"q10": 535.3, "q90": 657.44, "date": "2025-10-12", "median": 596.37, "confidence": 0.7}, {"q10": 528.75, "q90": 649.39, "date": "2025-10-13", "median": 589.07, "confidence": 0.69}, {"q10": 499.77, "q90": 613.8, "date": "2025-10-14", "median": 556.79, "confidence": 0.68}, {"q10": 530.53, "q90": 651.58, "date": "2025-10-15", "median": 591.06, "confidence": 0.67}, {"q10": 518.86, "q90": 637.25, "date": "2025-10-16", "median": 578.05, "confidence": 0.66}, {"q10": 525.41, "q90": 645.29, "date": "2025-10-17", "median": 585.35, "confidence": 0.65}, {"q10": 489.35, "q90": 601, "date": "2025-10-18", "median": 545.17, "confidence": 0.64}, {"q10": 511.13, "q90": 627.75, "date": "2025-10-19", "median": 569.44, "confidence": 0.63}, {"q10": 509.39, "q90": 625.62, "date": "2025-10-20", "median": 567.5, "confidence": 0.62}, {"q10": 489.94, "q90": 601.73, "date": "2025-10-21", "median": 545.83, "confidence": 0.61}, {"q10": 519.52, "q90": 638.06, "date": "2025-10-22", "median": 578.79, "confidence": 0.6}]	{"fqs": 92.3, "mase": 0.84, "picp": 94.7, "smape": 8.7, "coverage": 95.2}	v1.2.0	f	2025-09-22 15:37:17.027017	\N
d80fe59c-3521-4b32-9520-681b9e23c9bf	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-22 15:40:18.869	30	ensemble_lgb_arima_ets	[{"q10": 531.03, "q90": 652.19, "date": "2025-09-23", "median": 591.61, "confidence": 0.89}, {"q10": 526.79, "q90": 646.98, "date": "2025-09-24", "median": 586.88, "confidence": 0.88}, {"q10": 548.49, "q90": 673.64, "date": "2025-09-25", "median": 611.06, "confidence": 0.87}, {"q10": 531.39, "q90": 652.64, "date": "2025-09-26", "median": 592.01, "confidence": 0.86}, {"q10": 549.44, "q90": 674.81, "date": "2025-09-27", "median": 612.12, "confidence": 0.85}, {"q10": 550.41, "q90": 676, "date": "2025-09-28", "median": 613.21, "confidence": 0.84}, {"q10": 523.5, "q90": 642.94, "date": "2025-09-29", "median": 583.22, "confidence": 0.83}, {"q10": 507, "q90": 622.68, "date": "2025-09-30", "median": 564.84, "confidence": 0.82}, {"q10": 512.09, "q90": 628.92, "date": "2025-10-01", "median": 570.5, "confidence": 0.81}, {"q10": 551.92, "q90": 677.85, "date": "2025-10-02", "median": 614.89, "confidence": 0.8}, {"q10": 533.73, "q90": 655.5, "date": "2025-10-03", "median": 594.61, "confidence": 0.79}, {"q10": 503.14, "q90": 617.93, "date": "2025-10-04", "median": 560.53, "confidence": 0.78}, {"q10": 535.36, "q90": 657.51, "date": "2025-10-05", "median": 596.43, "confidence": 0.77}, {"q10": 552.43, "q90": 678.48, "date": "2025-10-06", "median": 615.46, "confidence": 0.76}, {"q10": 538.19, "q90": 660.99, "date": "2025-10-07", "median": 599.59, "confidence": 0.75}, {"q10": 552.92, "q90": 679.08, "date": "2025-10-08", "median": 616, "confidence": 0.74}, {"q10": 551.23, "q90": 677, "date": "2025-10-09", "median": 614.12, "confidence": 0.73}, {"q10": 534.51, "q90": 656.46, "date": "2025-10-10", "median": 595.48, "confidence": 0.72}, {"q10": 544.58, "q90": 668.83, "date": "2025-10-11", "median": 606.7, "confidence": 0.71}, {"q10": 511.33, "q90": 628, "date": "2025-10-12", "median": 569.67, "confidence": 0.7}, {"q10": 511.58, "q90": 628.3, "date": "2025-10-13", "median": 569.94, "confidence": 0.69}, {"q10": 535.3, "q90": 657.43, "date": "2025-10-14", "median": 596.37, "confidence": 0.68}, {"q10": 500.45, "q90": 614.63, "date": "2025-10-15", "median": 557.54, "confidence": 0.67}, {"q10": 536.18, "q90": 658.51, "date": "2025-10-16", "median": 597.34, "confidence": 0.66}, {"q10": 507.41, "q90": 623.18, "date": "2025-10-17", "median": 565.29, "confidence": 0.65}, {"q10": 526.02, "q90": 646.04, "date": "2025-10-18", "median": 586.03, "confidence": 0.64}, {"q10": 493.55, "q90": 606.16, "date": "2025-10-19", "median": 549.85, "confidence": 0.63}, {"q10": 512.45, "q90": 629.37, "date": "2025-10-20", "median": 570.91, "confidence": 0.62}, {"q10": 512.92, "q90": 629.95, "date": "2025-10-21", "median": 571.43, "confidence": 0.61}, {"q10": 520.21, "q90": 638.91, "date": "2025-10-22", "median": 579.56, "confidence": 0.6}]	{"fqs": 92.3, "mase": 0.84, "picp": 94.7, "smape": 8.7, "coverage": 95.2}	v1.2.0	f	2025-09-22 15:40:18.908294	\N
4ba8fc06-8066-4f34-88e7-ca26c9df8f5f	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-23 18:53:53.661562	30	ensemble_lgb_arima_ets	[{"q10": 1950.00, "q90": 2350.00, "date": "2025-09-24", "median": 2150.00, "confidence": 0.85}, {"q10": 1980.00, "q90": 2380.00, "date": "2025-09-25", "median": 2180.00, "confidence": 0.83}, {"q10": 2000.00, "q90": 2400.00, "date": "2025-09-26", "median": 2200.00, "confidence": 0.81}]	{"fqs": 89.3, "mase": 0.92, "picp": 94.5, "smape": 7.2, "coverage": 95.1}	v1.2.0	t	2025-09-23 18:53:53.661562	dev-coop-001
43c6be2e-e70d-4fb1-8fb4-d1a7a600613b	cb4683a6-6b47-49e6-8b83-4fce571e026e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-23 18:53:53.661562	30	ensemble_lgb_arima_ets	[{"q10": 1500.00, "q90": 1800.00, "date": "2025-09-24", "median": 1650.00, "confidence": 0.88}, {"q10": 1520.00, "q90": 1820.00, "date": "2025-09-25", "median": 1670.00, "confidence": 0.86}, {"q10": 1530.00, "q90": 1830.00, "date": "2025-09-26", "median": 1680.00, "confidence": 0.84}]	{"fqs": 91.7, "mase": 0.78, "picp": 95.2, "smape": 6.8, "coverage": 95.8}	v1.2.0	t	2025-09-23 18:53:53.661562	dev-coop-001
10903fc7-3daa-4492-a380-bbb036643a39	7488405f-55b6-4513-bdb5-004b6c33f016	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-23 18:53:53.661562	30	ensemble_lgb_arima_ets	[{"q10": 4800.00, "q90": 5600.00, "date": "2025-09-24", "median": 5200.00, "confidence": 0.82}, {"q10": 4850.00, "q90": 5650.00, "date": "2025-09-25", "median": 5250.00, "confidence": 0.80}, {"q10": 4900.00, "q90": 5700.00, "date": "2025-09-26", "median": 5300.00, "confidence": 0.78}]	{"fqs": 87.2, "mase": 1.05, "picp": 93.8, "smape": 9.1, "coverage": 94.3}	v1.2.0	t	2025-09-23 18:53:53.661562	dev-coop-001
c2df1009-4c28-4d53-9d21-b61decf035ea	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-23 19:07:36.837325	30	ensemble_lgb_arima_ets	[{"q10": 420.00, "q90": 480.00, "date": "2025-09-24", "median": 450.00, "confidence": 0.87}, {"q10": 425.00, "q90": 485.00, "date": "2025-09-25", "median": 455.00, "confidence": 0.85}, {"q10": 430.00, "q90": 490.00, "date": "2025-09-26", "median": 460.00, "confidence": 0.83}, {"q10": 435.00, "q90": 495.00, "date": "2025-09-27", "median": 465.00, "confidence": 0.81}, {"q10": 440.00, "q90": 500.00, "date": "2025-09-28", "median": 470.00, "confidence": 0.79}]	{"fqs": 93.5, "mase": 0.65, "picp": 96.2, "smape": 5.8, "coverage": 96.8}	v1.2.0	f	2025-09-23 19:07:36.837325	dev-coop-001
\.


--
-- Data for Name: forecasts_30d; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.forecasts_30d (id, forecast_run_id, commodity_id, region_id, forecast_date, target_date, days_ahead, median, q10, q25, q75, q90, confidence, trend, volatility, is_active, created_at, coop_id) FROM stdin;
\.


--
-- Data for Name: fx_rates; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.fx_rates (id, base_currency, target_currency, date, rate, source_id, is_active, created_at) FROM stdin;
\.


--
-- Data for Name: llm_verifications; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.llm_verifications (id, forecast_id, provider, model, prompt, response, confidence, metadata, verified, created_at, coop_id, forecast_30d_id) FROM stdin;
272456f9-3c1d-4099-95ea-407c1a0e25e8	9d17896a-72dc-4851-8154-b210da33322a	openai	gpt-5	Agricultural forecast verification analysis	Analysis unavailable	0.00	{"tokens": 826, "temperature": 0.2, "responseTime": 1758554815043}	f	2025-09-22 15:26:55.078299	\N	\N
32e2757f-6307-4a67-88af-6cbff00dd27f	9d17896a-72dc-4851-8154-b210da33322a	gemini	gemini-2.5-pro	Agricultural forecast verification analysis	Verification failed due to API error	0.00	{"error": "Gemini verification failed: {\\"error\\":{\\"code\\":503,\\"message\\":\\"The model is overloaded. Please try again later.\\",\\"status\\":\\"UNAVAILABLE\\"}}"}	f	2025-09-22 15:26:55.301824	\N	\N
5a85e049-f894-44c8-a0bd-58e60df119a5	be299cc6-e62f-42fd-88e5-dea93b0049a2	gemini	gemini-2.5-pro	Agricultural forecast verification analysis	The forecast methodology and results are sound. The use of an ensemble model combining ARIMA, ETS, and LightGBM is a sophisticated and appropriate approach for agricultural commodity price forecasting. This method effectively captures linear trends, seasonality, and complex non-linear patterns. The 15-day forecast horizon is reasonable for this asset class. The provided quality metrics, particularly a MASE below 1.0 and a high PICP of 94.7%, indicate that the model is both more accurate than a naive forecast and provides well-calibrated uncertainty intervals.	0.92	{"tokens": 0, "temperature": 0.1, "responseTime": 1758555028528}	t	2025-09-22 15:30:28.79365	\N	\N
34a909c7-cc98-4e78-b7fe-ce44645db5a6	be299cc6-e62f-42fd-88e5-dea93b0049a2	openai	gpt-5	Agricultural forecast verification analysis	Analysis unavailable	0.00	{"tokens": 826, "temperature": 0.2, "responseTime": 1758555013269}	f	2025-09-22 15:30:28.81254	\N	\N
4aab40c3-2ca7-490e-8377-e867a7b3b9cf	604d6904-ddc6-4407-873c-c8250c7843cc	openai	gpt-5	Agricultural forecast verification analysis	Analysis unavailable	0.00	{"tokens": 825, "temperature": 0.2, "responseTime": 1758555345819}	f	2025-09-22 15:35:54.969861	\N	\N
8ca6f531-fe48-4adf-af9d-1b99974072c0	604d6904-ddc6-4407-873c-c8250c7843cc	gemini	gemini-2.5-pro	Agricultural forecast verification analysis	The forecast appears sound and reliable. The use of an ensemble model (LightGBM, ARIMA, ETS) is a sophisticated and appropriate methodology for commodity price forecasting, as it captures non-linear relationships, time-series dependencies, and seasonal patterns. The quality metrics strongly support this conclusion: MASE below 1.0 indicates better performance than a naive forecast, SMAPE is within an acceptable range, and the high PICP (94.7%) shows that the model's uncertainty intervals are well-calibrated. The 30-day horizon is reasonable for this class of models. The stable price prediction is plausible and backed by a high average confidence.	0.95	{"tokens": 0, "temperature": 0.1, "responseTime": 1758555354717}	t	2025-09-22 15:35:54.992506	\N	\N
6b462b61-1b30-4d7d-8264-d4b3f6a1dc5d	56db8583-575d-4c08-8b8e-1ff5b0763aad	gemini	gemini-2.5-pro	Agricultural forecast verification analysis	The forecast methodology and results appear sound. The use of an ensemble model (LightGBM, ARIMA, ETS) is a sophisticated and appropriate approach for capturing complex dynamics in agricultural commodity prices, including non-linear trends, seasonality, and volatility. The 30-day forecast horizon is reasonable for this asset class. The provided quality metrics strongly support the model's validity: a MASE below 1.0 indicates better-than-naive performance, the sMAPE is within an acceptable range for volatile markets, and the high PICP demonstrates that the model's uncertainty estimates are well-calibrated and reliable.	0.95	{"tokens": 0, "temperature": 0.1, "responseTime": 1758555457851}	t	2025-09-22 15:37:38.123576	\N	\N
31fb8d3d-c8fd-41c6-9032-2851bf657a08	56db8583-575d-4c08-8b8e-1ff5b0763aad	openai	gpt-5	Agricultural forecast verification analysis	Analysis unavailable	0.00	{"tokens": 825, "temperature": 0.2, "responseTime": 1758555446270}	f	2025-09-22 15:37:38.137734	\N	\N
b51e3cc7-7642-4653-8cff-f93baa27b444	d80fe59c-3521-4b32-9520-681b9e23c9bf	openai	gpt-5	Agricultural forecast verification analysis	Analysis unavailable	0.00	{"tokens": 825, "temperature": 0.2, "responseTime": 1758555626316}	f	2025-09-22 15:40:26.738372	\N	\N
0925a0c4-5a02-43e0-9ad5-009373573e26	d80fe59c-3521-4b32-9520-681b9e23c9bf	gemini	gemini-2.5-pro	Agricultural forecast verification analysis	Verification failed due to API error	0.00	{"error": "Gemini verification failed: {\\"error\\":{\\"code\\":503,\\"message\\":\\"The model is overloaded. Please try again later.\\",\\"status\\":\\"UNAVAILABLE\\"}}"}	f	2025-09-22 15:40:27.044698	\N	\N
\.


--
-- Data for Name: price_data; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.price_data (id, commodity_id, region_id, date, price, currency, source, quality_score, metadata, created_at, coop_id) FROM stdin;
69e82325-2865-4b24-bff5-2a71d9fec614	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-11 00:00:00	2625.40	USD	Mekong Coffee Exchange	0.97	\N	2025-09-22 15:25:45.326454	\N
6e286c58-7a63-4367-848e-2f30537cedc8	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-07-24 00:00:00	620.00	USD	Vietnam Commodity Exchange	0.95	\N	2025-09-22 15:20:22.076055	\N
6e05bd2f-62ce-4e25-b7f4-a462a06d922f	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-07-31 00:00:00	615.50	USD	Vietnam Commodity Exchange	0.92	\N	2025-09-22 15:20:22.076055	\N
0eaf6dab-87d1-4d04-8da7-089895236663	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-07 00:00:00	610.20	USD	Vietnam Commodity Exchange	0.94	\N	2025-09-22 15:20:22.076055	\N
9444bdbb-9c01-4fc1-9325-553937bc70a1	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-14 00:00:00	605.80	USD	Vietnam Commodity Exchange	0.93	\N	2025-09-22 15:20:22.076055	\N
6acc0cd4-4aed-46db-81e2-dadbf1e29c3f	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-21 00:00:00	598.40	USD	Vietnam Commodity Exchange	0.91	\N	2025-09-22 15:20:22.076055	\N
4d2d6587-2adb-4a30-bd2f-833c13b91745	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-28 00:00:00	594.70	USD	Vietnam Commodity Exchange	0.94	\N	2025-09-22 15:20:22.076055	\N
424159b1-fc3f-4303-85d8-a4a168e32a60	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-04 00:00:00	587.30	USD	Vietnam Commodity Exchange	0.96	\N	2025-09-22 15:20:22.076055	\N
c1ceba84-6d2d-4707-a324-826be77769aa	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-11 00:00:00	583.90	USD	Vietnam Commodity Exchange	0.95	\N	2025-09-22 15:20:22.076055	\N
cd8cbaac-ff1c-4ca8-8652-3a25c83a82c2	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-18 00:00:00	580.60	USD	Vietnam Commodity Exchange	0.97	\N	2025-09-22 15:20:22.076055	\N
abb82034-0642-4bcb-8fa6-720deca52934	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-22 00:00:00	578.20	USD	Vietnam Commodity Exchange	0.94	\N	2025-09-22 15:20:22.076055	\N
7ffae289-ee91-4e7e-98e1-14ec4a5b4079	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-07-24 00:00:00	2400.00	USD	ICE Coffee Futures	0.98	\N	2025-09-22 15:20:36.002679	\N
c46e006a-3551-42e2-99aa-97a262cb3768	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-07-31 00:00:00	2435.20	USD	ICE Coffee Futures	0.97	\N	2025-09-22 15:20:36.002679	\N
dbdd13af-9050-419d-83f4-5cd69cfce48a	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-07 00:00:00	2468.80	USD	ICE Coffee Futures	0.96	\N	2025-09-22 15:20:36.002679	\N
3335857b-d0e1-426b-bbe4-b2aae6ce4188	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-14 00:00:00	2502.60	USD	ICE Coffee Futures	0.94	\N	2025-09-22 15:20:36.002679	\N
0dd105a5-40b9-497a-80c8-2fa3e571268d	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-21 00:00:00	2545.40	USD	ICE Coffee Futures	0.95	\N	2025-09-22 15:20:36.002679	\N
5459e262-71f6-49d3-ba06-203ea87f9dd4	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-28 00:00:00	2578.90	USD	ICE Coffee Futures	0.93	\N	2025-09-22 15:20:36.002679	\N
50c86497-bc77-4661-8232-48efe20a9d77	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-04 00:00:00	2615.70	USD	ICE Coffee Futures	0.97	\N	2025-09-22 15:20:36.002679	\N
ba64253f-5402-43e1-8008-9f8eb132619c	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-11 00:00:00	2648.20	USD	ICE Coffee Futures	0.98	\N	2025-09-22 15:20:36.002679	\N
8e1859ce-36e0-49e2-b43e-3c6d62072bb5	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-18 00:00:00	2672.50	USD	ICE Coffee Futures	0.96	\N	2025-09-22 15:20:36.002679	\N
3bd7b361-dd2d-4093-aae1-2fcbaffd5e80	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-22 00:00:00	2680.30	USD	ICE Coffee Futures	0.95	\N	2025-09-22 15:20:36.002679	\N
53914d2b-bdde-4f2e-8224-84a17ff014db	7488405f-55b6-4513-bdb5-004b6c33f016	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-07-24 00:00:00	6500.00	USD	Vietnam Pepper Association	0.92	\N	2025-09-22 15:20:53.383898	\N
9ab7984f-f1d1-4b8d-8640-7d7512ff4bf2	7488405f-55b6-4513-bdb5-004b6c33f016	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-07 00:00:00	6750.20	USD	Vietnam Pepper Association	0.94	\N	2025-09-22 15:20:53.383898	\N
d95a1a0a-c604-4fce-aa58-eaf05b2780f9	7488405f-55b6-4513-bdb5-004b6c33f016	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-21 00:00:00	6420.80	USD	Vietnam Pepper Association	0.89	\N	2025-09-22 15:20:53.383898	\N
932f33a3-e111-431a-8f26-3a8c60e84db1	7488405f-55b6-4513-bdb5-004b6c33f016	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-04 00:00:00	6680.50	USD	Vietnam Pepper Association	0.93	\N	2025-09-22 15:20:53.383898	\N
471a632d-25a6-4930-a917-6f8fbb58148c	7488405f-55b6-4513-bdb5-004b6c33f016	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-22 00:00:00	6590.30	USD	Vietnam Pepper Association	0.91	\N	2025-09-22 15:20:53.383898	\N
0b99ea17-25fe-453f-898b-df3fced23a90	1051d6c3-baf4-40b2-b63f-7c086f473573	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-07-24 00:00:00	420.00	USD	Petrovietnam Fertilizer	0.98	\N	2025-09-22 15:20:53.383898	\N
026b4d37-4379-42d5-9101-07dac6f523b2	1051d6c3-baf4-40b2-b63f-7c086f473573	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-07 00:00:00	425.80	USD	Petrovietnam Fertilizer	0.97	\N	2025-09-22 15:20:53.383898	\N
41af8b9d-46a6-4375-9b88-b8f196e63123	1051d6c3-baf4-40b2-b63f-7c086f473573	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-21 00:00:00	432.40	USD	Petrovietnam Fertilizer	0.96	\N	2025-09-22 15:20:53.383898	\N
db19de67-c968-4ef1-84ce-a9378bd05f35	1051d6c3-baf4-40b2-b63f-7c086f473573	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-04 00:00:00	438.90	USD	Petrovietnam Fertilizer	0.98	\N	2025-09-22 15:20:53.383898	\N
c20c54f3-bb19-417e-ab6a-6553fedada5c	1051d6c3-baf4-40b2-b63f-7c086f473573	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-22 00:00:00	445.20	USD	Petrovietnam Fertilizer	0.97	\N	2025-09-22 15:20:53.383898	\N
6fecfab3-6c43-477c-8440-99f6961929c6	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-07-24 00:00:00	2380.00	USD	Mekong Coffee Exchange	0.96	\N	2025-09-22 15:25:45.326454	\N
41aea112-10d0-4f2c-acdc-2dc93aa6f5f7	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-07-31 00:00:00	2410.50	USD	Mekong Coffee Exchange	0.95	\N	2025-09-22 15:25:45.326454	\N
4bf2151f-fdbf-4aa8-9681-fc75fb34c54c	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-07 00:00:00	2445.20	USD	Mekong Coffee Exchange	0.97	\N	2025-09-22 15:25:45.326454	\N
ded0eef2-2db5-4af4-ab34-0e14ce7979bb	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-14 00:00:00	2478.30	USD	Mekong Coffee Exchange	0.93	\N	2025-09-22 15:25:45.326454	\N
5e939882-64b0-465a-b709-ea9689339819	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-21 00:00:00	2520.80	USD	Mekong Coffee Exchange	0.94	\N	2025-09-22 15:25:45.326454	\N
4c6406c2-1256-457b-ad49-c99421e27701	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-08-28 00:00:00	2553.60	USD	Mekong Coffee Exchange	0.96	\N	2025-09-22 15:25:45.326454	\N
1eda17a4-273b-447d-b025-f590a64b2881	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-04 00:00:00	2590.20	USD	Mekong Coffee Exchange	0.95	\N	2025-09-22 15:25:45.326454	\N
6060c266-a247-4b51-80d4-a15dda16bf9f	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-18 00:00:00	2648.90	USD	Mekong Coffee Exchange	0.94	\N	2025-09-22 15:25:45.326454	\N
8bc4df36-8c08-43bb-9eb8-3b7f7c7c15bb	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-09-22 00:00:00	2655.70	USD	Mekong Coffee Exchange	0.96	\N	2025-09-22 15:25:45.326454	\N
f9070f29-5da6-4a53-a2e1-66de1b592177	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-01-15 00:00:00	2100.00	USD	Mekong Coffee Exchange	0.94	\N	2025-09-22 15:26:33.473489	\N
f1934f49-399c-487c-9bcd-fa05fd961ca8	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-02-01 00:00:00	2120.50	USD	Mekong Coffee Exchange	0.93	\N	2025-09-22 15:26:33.473489	\N
b46d7654-149f-4609-81b9-1527b074638b	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-02-15 00:00:00	2135.80	USD	Mekong Coffee Exchange	0.95	\N	2025-09-22 15:26:33.473489	\N
fb3e1f3f-0303-41b8-915c-19b4e8d41bcf	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-03-01 00:00:00	2150.20	USD	Mekong Coffee Exchange	0.96	\N	2025-09-22 15:26:33.473489	\N
ad7e922c-2600-447b-afa6-e976de0fd782	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-03-15 00:00:00	2165.90	USD	Mekong Coffee Exchange	0.92	\N	2025-09-22 15:26:33.473489	\N
81c6b7c3-ce05-4155-aef3-cb8f08a2a535	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-04-01 00:00:00	2180.40	USD	Mekong Coffee Exchange	0.97	\N	2025-09-22 15:26:33.473489	\N
d9b0abef-7355-4b5b-b7f2-fcf7907747a7	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-04-15 00:00:00	2198.60	USD	Mekong Coffee Exchange	0.93	\N	2025-09-22 15:26:33.473489	\N
a3d118e5-864f-4867-9980-81ee1313850d	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-05-01 00:00:00	2215.30	USD	Mekong Coffee Exchange	0.95	\N	2025-09-22 15:26:33.473489	\N
96482ede-dac3-48e6-808e-b5ffb02e6337	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-05-15 00:00:00	2230.80	USD	Mekong Coffee Exchange	0.94	\N	2025-09-22 15:26:33.473489	\N
619cfd1e-5fc9-4a56-b46a-2a198cc9a844	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-06-01 00:00:00	2248.50	USD	Mekong Coffee Exchange	0.96	\N	2025-09-22 15:26:33.473489	\N
e8653b9e-322c-4e53-ac79-e6fe19c66c10	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-06-15 00:00:00	2265.20	USD	Mekong Coffee Exchange	0.93	\N	2025-09-22 15:26:33.473489	\N
e3d3e1f9-5964-43a4-ac90-9d5f20666c23	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-07-01 00:00:00	2285.70	USD	Mekong Coffee Exchange	0.98	\N	2025-09-22 15:26:33.473489	\N
0a02c217-ea41-44a3-aeeb-11ff936ed281	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-07-15 00:00:00	2305.40	USD	Mekong Coffee Exchange	0.95	\N	2025-09-22 15:26:33.473489	\N
85e3b63b-d942-4822-acf5-9d46514e6395	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-01-01 00:00:00	2080.00	USD	Mekong Coffee Exchange	0.91	\N	2025-09-22 15:26:33.473489	\N
af16d908-dd18-4eae-961f-f0784bc879db	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-01-30 00:00:00	2110.30	USD	Mekong Coffee Exchange	0.94	\N	2025-09-22 15:26:33.473489	\N
7660df88-9839-4fad-a200-c69a91838925	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-02-28 00:00:00	2142.80	USD	Mekong Coffee Exchange	0.96	\N	2025-09-22 15:26:33.473489	\N
5e5a3828-66a9-4ce1-be0c-e3fa88643af2	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-03-31 00:00:00	2175.60	USD	Mekong Coffee Exchange	0.92	\N	2025-09-22 15:26:33.473489	\N
e8fc4b25-d192-4c81-af7a-cfdbad77d5df	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-04-30 00:00:00	2208.90	USD	Mekong Coffee Exchange	0.97	\N	2025-09-22 15:26:33.473489	\N
e7890f20-552e-4893-b817-b22339074aac	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-05-31 00:00:00	2240.15	USD	Mekong Coffee Exchange	0.95	\N	2025-09-22 15:26:33.473489	\N
6200fa4a-2a07-4a33-ab67-3e5db098986a	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-06-30 00:00:00	2275.80	USD	Mekong Coffee Exchange	0.93	\N	2025-09-22 15:26:33.473489	\N
f790f99d-4e66-49c8-818a-cfac3e2f7c57	82f18091-2d07-43d6-9653-bf7708f1948e	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-07-08 00:00:00	2295.40	USD	Mekong Coffee Exchange	0.96	\N	2025-09-22 15:26:33.473489	\N
a013d3c1-34bb-47e0-9e14-ce22da2b175c	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-01-15 00:00:00	680.00	USD	Vietnam Commodity Exchange	0.96	\N	2025-09-22 15:35:22.199347	\N
32c7c686-206d-4e5b-be05-0811dff6be27	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-02-01 00:00:00	675.20	USD	Vietnam Commodity Exchange	0.94	\N	2025-09-22 15:35:22.199347	\N
122acdf2-2065-4a3d-9d91-2b205548c693	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-02-15 00:00:00	670.80	USD	Vietnam Commodity Exchange	0.93	\N	2025-09-22 15:35:22.199347	\N
1eaac4e8-5299-4aae-8310-3088515b3407	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-03-01 00:00:00	665.40	USD	Vietnam Commodity Exchange	0.95	\N	2025-09-22 15:35:22.199347	\N
9a342fe6-b0eb-45a9-8f88-e5e5f1fc932f	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-03-15 00:00:00	660.90	USD	Vietnam Commodity Exchange	0.92	\N	2025-09-22 15:35:22.199347	\N
55e1608f-bb1e-4afc-bd31-61d9aae23cff	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-04-01 00:00:00	655.60	USD	Vietnam Commodity Exchange	0.97	\N	2025-09-22 15:35:22.199347	\N
c20c2e54-5ba7-4c0c-8193-8c4bdef7934a	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-04-15 00:00:00	650.30	USD	Vietnam Commodity Exchange	0.93	\N	2025-09-22 15:35:22.199347	\N
314a3270-bd36-4e45-9bf9-ce4e929a2b68	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-05-01 00:00:00	645.80	USD	Vietnam Commodity Exchange	0.95	\N	2025-09-22 15:35:22.199347	\N
cf57883c-355e-4197-8d8a-fb0a8f868cf2	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-05-15 00:00:00	640.40	USD	Vietnam Commodity Exchange	0.94	\N	2025-09-22 15:35:22.199347	\N
51f455c7-8303-488b-bbf5-501b7ace2a4f	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-06-01 00:00:00	635.90	USD	Vietnam Commodity Exchange	0.96	\N	2025-09-22 15:35:22.199347	\N
9ed16460-b3b3-4361-8120-548c0ffbfe56	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-06-15 00:00:00	630.20	USD	Vietnam Commodity Exchange	0.93	\N	2025-09-22 15:35:22.199347	\N
3de4b0e0-c17e-4dce-8ceb-501c6b967762	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-07-01 00:00:00	625.70	USD	Vietnam Commodity Exchange	0.98	\N	2025-09-22 15:35:22.199347	\N
15c2cb2d-0a23-43fd-bf78-d823449c11cd	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-07-15 00:00:00	622.80	USD	Vietnam Commodity Exchange	0.95	\N	2025-09-22 15:35:22.199347	\N
75fbbb76-b913-4592-9611-ce07d714e239	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-01-01 00:00:00	685.00	USD	Vietnam Commodity Exchange	0.91	\N	2025-09-22 15:35:22.199347	\N
ddb2f7ff-b374-403a-96ab-46493a66ab88	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-01-30 00:00:00	678.30	USD	Vietnam Commodity Exchange	0.94	\N	2025-09-22 15:35:22.199347	\N
b77dedf3-0672-4577-b5e3-cc928e02c6fe	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-02-28 00:00:00	672.80	USD	Vietnam Commodity Exchange	0.96	\N	2025-09-22 15:35:22.199347	\N
f50aeff5-9973-43ea-85ae-d8435941816d	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-03-31 00:00:00	668.60	USD	Vietnam Commodity Exchange	0.92	\N	2025-09-22 15:35:22.199347	\N
a15cf16f-b110-4916-9cef-40d2e4088822	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-04-30 00:00:00	663.90	USD	Vietnam Commodity Exchange	0.97	\N	2025-09-22 15:35:22.199347	\N
92d73bce-f8ec-4594-9082-5ce21cb89c66	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-05-31 00:00:00	658.15	USD	Vietnam Commodity Exchange	0.95	\N	2025-09-22 15:35:22.199347	\N
afe38746-7e3b-4f03-9f65-291f6af1ea4e	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-06-30 00:00:00	652.80	USD	Vietnam Commodity Exchange	0.93	\N	2025-09-22 15:35:22.199347	\N
468075c4-6dc2-4f07-8dbe-05ce17c0d037	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2024-07-08 00:00:00	648.40	USD	Vietnam Commodity Exchange	0.96	\N	2025-09-22 15:35:22.199347	\N
e85bff82-3ee6-4e6b-be94-edfb4bd813f8	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-09 18:54:44.823	577.70	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:45.146415	\N
b6fcb2cc-5b31-4873-9bfd-fa349ce65d24	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-10 18:54:44.823	598.32	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:45.240596	\N
702be5a2-c4ce-4b25-b9fd-76faf8cadbfd	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-11 18:54:44.823	589.67	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:45.315292	\N
d6e79c1a-258e-4aad-b217-dc0083a2dc20	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-12 18:54:44.823	584.48	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:45.390088	\N
b1319d7f-9ddd-4b07-8d5d-7fb3f8963cf6	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-13 18:54:44.823	580.96	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:45.465814	\N
9565479f-6e5c-431a-a595-40c074a5869d	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-14 18:54:44.823	571.43	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:45.556298	\N
231ba29a-0cf3-46ba-9fc9-ba7d0a34ef4b	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-15 18:54:44.823	572.87	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:45.631058	\N
1c45d7cb-f274-4f67-83ea-e47293ba50f6	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-16 18:54:44.823	573.67	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:45.705648	\N
42cd6af1-fe66-44c8-b2d1-21105abeab64	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-17 18:54:44.823	567.78	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:45.78006	\N
f1ea8098-3065-48b0-92f8-450ba3b081bb	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-18 18:54:44.823	590.16	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:45.854378	\N
37bf3714-bd9f-4d1f-b3f7-95d300ddd7ae	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-19 18:54:44.823	589.35	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:45.93186	\N
352a849f-8b21-492b-ac8e-9a5ae80bba6b	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-20 18:54:44.823	605.44	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:46.006117	\N
e4ed891b-a280-4f3e-afb1-26e5038144e6	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-21 18:54:44.823	620.85	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:46.080513	\N
9afb004f-ccd7-43a2-b922-63094a9fe731	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-22 18:54:44.823	644.02	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:46.156528	\N
d532c331-b1f6-4296-bace-392b51499169	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-23 18:54:44.823	660.96	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:46.231267	\N
d265ef71-bf13-474b-83c8-219377bd57d2	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-24 18:54:44.823	675.02	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:46.305715	\N
84cc759c-e004-4edb-8447-2cbddac10baf	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-25 18:54:44.823	670.13	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:46.380073	\N
0ccc8353-c6cc-4312-bc6c-479dacd5e4ca	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-26 18:54:44.823	672.27	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:46.454375	\N
d2e92c1b-756c-4674-b968-642dcb5f33d9	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-27 18:54:44.823	684.22	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:46.527711	\N
6fbf421b-d82e-454e-bf8e-296ede321305	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-28 18:54:44.823	668.52	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:46.602045	\N
cc866dac-a943-4932-8fae-dd3945a71bb2	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-29 18:54:44.823	687.61	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:46.676854	\N
320efbe7-cf31-46c7-a6c5-fc3252c02c98	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-30 18:54:44.823	678.27	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:46.751467	\N
4a4258cc-3095-40b6-b3d2-edcd4177dba1	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-31 18:54:44.823	654.82	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:46.825962	\N
08bf9b77-8a55-4453-a81c-5a6bd3ec0f2b	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-01 18:54:44.823	642.48	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:46.900187	\N
60d2b751-cd04-4971-b039-00d287dc0620	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-02 18:54:44.823	622.26	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:46.975363	\N
d39afd45-25d1-4bb4-b894-a3287f20f224	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-03 18:54:44.823	615.80	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:47.049515	\N
28651e4c-13b0-4dd7-94db-e9c8c5bbeebd	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-04 18:54:44.823	620.54	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:47.123583	\N
14598b34-af70-4ba7-8d82-adc9d0360a90	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-05 18:54:44.823	609.05	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:47.200707	\N
1c73c3d4-5a5d-408b-995a-bbadb0919ea7	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-06 18:54:44.823	630.52	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:47.275066	\N
d4a3c0e0-a870-48eb-9cd6-46dc504bf5ee	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-07 18:54:44.823	630.42	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:47.349597	\N
2fc1417c-5128-47c1-9009-56fcd46d2fb5	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-08 18:54:44.823	639.61	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:47.423598	\N
6476357c-93e5-4e3a-9bce-33b6c175bf6c	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-09 18:54:44.823	623.93	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:47.497969	\N
43552a57-3d2d-4b48-9c2c-981288467288	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-10 18:54:44.823	643.90	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:47.57258	\N
8f3472c6-06d2-4419-a0d8-6c8331c42d64	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-11 18:54:44.823	642.49	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:47.646912	\N
ff9b8ae3-f0f7-426d-a0e7-ff620be8c389	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-12 18:54:44.823	631.75	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:47.721132	\N
fefeffb0-a2b2-4719-960b-dc4c6ead240e	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-13 18:54:44.823	629.57	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:47.795094	\N
8d24fd18-2e98-4fce-8ae2-b19c77ff983e	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-14 18:54:44.823	613.15	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:47.869201	\N
7206b616-0d4c-4ad2-ae1d-05712b0fe6f5	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-15 18:54:44.823	603.79	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:47.9434	\N
59ab9d8e-4c19-453a-94f2-dfe48da42bb8	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-16 18:54:44.823	602.68	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:48.017508	\N
49b27f81-4da9-415c-938d-ee15361da7db	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-17 18:54:44.823	584.11	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:48.091779	\N
f0836251-564b-49b1-a25b-0b6d452c2124	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-18 18:54:44.823	596.54	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:48.165744	\N
d2f01b3c-e2e2-4ecc-9e5c-025aa53f4292	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-19 18:54:44.823	614.90	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:48.239941	\N
36f3519f-1983-42e4-8249-76079cd9127c	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-20 18:54:44.823	603.05	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:48.314584	\N
89d93277-54d7-47ac-bf17-8b1ecf3315a7	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-21 18:54:44.823	622.45	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:48.388771	\N
f0959f28-42da-4b7c-a4e9-9a2b4da61c57	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-22 18:54:44.823	614.22	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:48.46316	\N
75663a23-13ee-45ee-99c6-0240a5b44565	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-23 18:54:44.823	620.46	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:48.537679	\N
5103525b-122a-4b06-adf0-bd23ca4c6e07	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-24 18:54:44.823	644.20	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:48.61168	\N
9e6748a7-4efa-4914-bf74-b4e85493b420	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-25 18:54:44.823	665.70	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:48.685627	\N
74e55682-fa3d-4625-a401-836aa85754be	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-26 18:54:44.823	667.53	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:48.75863	\N
653a2bac-697d-4910-b4a5-1c1148e0d9e5	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-27 18:54:44.823	669.67	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:48.831759	\N
e7c8e8f5-f21d-4996-be71-e1f60fa9f606	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-28 18:54:44.823	666.34	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:48.906098	\N
22c2e97c-c5e2-464f-a9d0-ff4c38c375c1	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-29 18:54:44.823	644.35	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:48.982911	\N
44e2f83c-a8c1-47e0-bded-1fabf3cb490e	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-30 18:54:44.823	653.92	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:49.05755	\N
02e82322-b9a0-4ad0-bdfc-a3d4240f657b	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-31 18:54:44.823	656.78	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:49.131638	\N
205c7b0a-7f9a-4d35-9f9d-953e39be941e	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-01 18:54:44.823	643.43	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:49.205385	\N
a7c45d5c-f51d-427e-8955-dad37a4c68a2	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-02 18:54:44.823	629.79	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:49.279763	\N
b2bf7770-c4a5-4b38-85fb-e0531663d970	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-03 18:54:44.823	646.16	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:49.353702	\N
8eddcb6c-cebb-4620-9ef0-4d9f2bb03317	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-04 18:54:44.823	669.24	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:49.430481	\N
865e041f-9cba-4efd-ba2c-b46d2af439a8	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-05 18:54:44.823	644.12	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:49.504568	\N
d96cf755-ef6b-4f06-b33e-76b45b237c20	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-06 18:54:44.823	647.07	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:49.578554	\N
a85b48cc-69e0-4296-9842-176911f825c2	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-07 18:54:44.823	629.76	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:49.651684	\N
e552534c-ac61-4bef-b097-a1dc09d630d3	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-08 18:54:44.823	640.13	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:49.725635	\N
7d5300e5-6f7a-4446-b5d8-0a5ece778e19	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-09 18:54:44.823	641.59	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:49.798725	\N
0a088e0a-9b5c-4a23-b9cc-62a8ae17ede2	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-10 18:54:44.823	658.27	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:49.873066	\N
5d3c0e87-504a-4f76-8e2a-fa0c9deeeda0	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-11 18:54:44.823	679.25	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:49.947132	\N
095e65ec-3b58-4972-b222-93c08686a065	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-12 18:54:44.823	700.12	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:50.021213	\N
134ebea0-6c2a-4ccf-ba96-98bd3ee1a97a	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-13 18:54:44.823	727.42	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:50.095033	\N
90c65f11-0d0c-41a2-b875-a8fab6b5839b	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-14 18:54:44.823	743.42	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:50.169247	\N
f132e88e-4ae0-4e56-ba87-51ef4465b5c0	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-15 18:54:44.823	741.96	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:50.243477	\N
d1f52778-3580-44fe-931c-4cf2dfdbfce5	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-16 18:54:44.823	733.24	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:50.317675	\N
e430138d-3421-4240-b689-b175faa62612	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-17 18:54:44.823	754.30	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:50.392061	\N
61e91263-5a98-47d2-adc8-8cccda6ca29e	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-18 18:54:44.823	777.94	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:50.466325	\N
4107d243-12ca-4610-bf15-145b35bf4c86	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-19 18:54:44.823	758.75	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:50.540428	\N
a060f0bc-6c91-4b0c-9a67-63e9a11ab7a0	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-20 18:54:44.823	787.55	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:50.614189	\N
5b7f6d52-ad27-4ea2-a9ee-827a752a2265	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-21 18:54:44.823	786.54	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:50.692852	\N
9a6731f1-91bb-4cb1-bd34-3af9c3e8ea65	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-22 18:54:44.823	817.46	USD	historical_seed	0.95	{"generated": true, "seed_date": "2025-09-22T18:54:44.824Z", "base_price": 580, "volatility": 0.04}	2025-09-22 18:54:50.768987	\N
\.


--
-- Data for Name: prices_raw; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.prices_raw (id, source_id, commodity_id, region_id, date, price, currency, volume, unit, raw_data, is_processed, created_at, evidence_urls, source_type, page_hashes, aggregation_metadata, coop_id) FROM stdin;
5e6b2f61-5fff-4848-9aad-c8008431e22a	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-09 00:00:00	580.67	USD	613.84	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
62df0bc1-be73-496e-a605-8aa0c7e7cda6	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-10 00:00:00	596.60	USD	576.63	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
48631f50-1f06-4366-ba75-b533cfd157ff	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-11 00:00:00	552.77	USD	537.44	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
d703f91e-100d-4b99-b703-24a9be948b40	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-12 00:00:00	565.84	USD	819.20	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
e92bba9f-fc99-42ab-9c42-c4737e4568aa	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-13 00:00:00	555.65	USD	922.87	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
167abf08-0cfe-459f-af56-099fcc4bfa59	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-14 00:00:00	559.52	USD	539.83	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
a1f67048-4c57-4039-b96e-1b9b283188be	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-15 00:00:00	595.78	USD	681.81	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
3d2da61d-29c3-49a8-b839-083a3af16624	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-16 00:00:00	570.25	USD	752.56	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
04912b9b-4451-4904-bef2-d1b2eaad717a	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-17 00:00:00	550.98	USD	901.93	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
d0624932-3246-44b2-b0f8-61eef2362661	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-18 00:00:00	566.29	USD	923.66	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
00cec3fb-406d-4725-ace1-74e0392f2574	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-19 00:00:00	560.58	USD	884.81	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
c716b260-3bda-4f38-a19c-baab8038967f	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-20 00:00:00	590.27	USD	670.17	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
3279ec80-438b-4f67-b834-d076653f6bd3	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-21 00:00:00	553.81	USD	701.18	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
6b207879-af7d-4c15-a4db-437ee24fb79c	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-22 00:00:00	559.22	USD	779.38	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
13371551-5f75-418a-a46c-5b6897620ca3	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-23 00:00:00	595.42	USD	545.53	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
0dc76115-e2b7-4a65-965c-2df7410c6e52	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-24 00:00:00	583.06	USD	947.80	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
ee88a384-7200-40e6-88d8-48c955a30378	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-25 00:00:00	595.22	USD	933.88	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
f371cddb-d8c2-4f9e-a169-e7a56f5f3475	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-26 00:00:00	565.35	USD	807.45	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
90b924eb-ef1e-4200-97de-0d4e80d61bf2	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-27 00:00:00	551.92	USD	920.89	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
e716305e-7e97-4119-aca8-89a3c8d06003	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-28 00:00:00	571.08	USD	990.90	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
1edb0b99-03e4-44ab-909b-56523c7b809e	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-29 00:00:00	588.04	USD	625.29	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
71bd84e0-5aba-4743-9022-5cf49d1396d0	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-30 00:00:00	583.43	USD	932.14	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
5b684596-c0e7-41a1-b844-2b56373535ec	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-31 00:00:00	558.72	USD	663.14	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
718f4e36-4466-40f6-9107-a98c50da8570	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-01 00:00:00	561.21	USD	627.80	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
89f2cac1-beea-43b5-8192-9dd279ee6bed	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-02 00:00:00	584.18	USD	733.17	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
a1458e66-dc5a-4ccb-8f2f-86066c256e6f	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-03 00:00:00	562.03	USD	804.52	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
8233992f-5abc-4217-aab7-4bc4f067f620	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-04 00:00:00	577.05	USD	805.31	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
1c641316-d0db-44c6-8db7-e7d23a0c6e17	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-05 00:00:00	585.42	USD	649.71	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
11eb1513-f02d-415f-b7e7-ec867df2817f	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-06 00:00:00	587.31	USD	872.64	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
0346f07a-9ffc-4f0a-b302-20060208073d	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-07 00:00:00	564.42	USD	898.83	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
011f78ac-b8f3-4d62-8f34-42091cb9471d	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-08 00:00:00	586.78	USD	979.90	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
14eacdda-9282-4cdf-ac98-165765b687df	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-09 00:00:00	564.85	USD	505.22	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
004beb6f-4852-48dd-8c14-e78ca32b817d	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-10 00:00:00	563.85	USD	629.73	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
cabeb266-359e-426b-8fb8-fc91603f85dd	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-11 00:00:00	568.81	USD	761.90	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
bf4bcbd5-2c19-4613-9163-d959cf535ae3	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-12 00:00:00	556.51	USD	637.45	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
aed1fe81-64d8-45ad-86dc-3119b17ccd39	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-13 00:00:00	548.02	USD	563.06	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
694cd27f-de00-448d-9588-f2b83a310ad7	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-14 00:00:00	588.67	USD	799.45	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
517e7d84-2b5e-4034-9ae6-c1caffa214a5	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-15 00:00:00	579.87	USD	924.64	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
62cfb0e1-9e87-4e2a-9105-3a3afac37ccf	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-16 00:00:00	547.76	USD	614.46	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
1275bac5-501b-4283-8a07-d1d820eeb90c	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-17 00:00:00	570.23	USD	605.93	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
8be91ee6-dd68-4fbf-9bd0-c4750b3669c1	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-18 00:00:00	554.54	USD	898.36	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
7d1629d8-d98c-4125-b583-38d2e440f3b1	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-19 00:00:00	553.43	USD	621.81	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
83d220a8-63a8-4193-9554-cbe280cfe7da	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-20 00:00:00	556.51	USD	816.72	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
171a3c3d-d44e-4ddb-9e98-0ec543fbf0d3	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-21 00:00:00	575.02	USD	979.70	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
5c057ba0-fd6b-464c-aab7-2210f681d241	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-22 00:00:00	568.19	USD	644.33	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
9c054194-a26e-4e38-93f8-311a4a5845d7	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-23 00:00:00	573.35	USD	808.00	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
9c9916ef-7bcc-49fb-a223-70dc5f9c52ee	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-24 00:00:00	569.54	USD	729.50	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
853fab6a-b5bf-4abf-a8eb-bc4646afca8d	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-25 00:00:00	570.95	USD	653.19	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
b0eb4df4-6935-4965-84a9-76ee0e6228e7	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-26 00:00:00	556.71	USD	612.25	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
b08be896-9a9d-449b-b471-10b8648d7255	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-27 00:00:00	571.74	USD	621.97	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
91dcb457-b42b-4b97-a336-c320e9aa9f3a	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-28 00:00:00	553.69	USD	747.84	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
93d11396-a66d-4667-b1ea-43209ec73c20	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-29 00:00:00	579.56	USD	502.11	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
53a25593-8871-40dc-acb0-8aa40d5ab711	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-30 00:00:00	545.15	USD	692.24	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
f33867f0-9e89-4a3c-bdef-54d3be249d3d	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-31 00:00:00	578.89	USD	674.23	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
b94f8db2-81b8-49bf-b8db-4255cbf88bbd	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-01 00:00:00	588.65	USD	853.07	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
32904a27-5b66-4211-8b0c-0cfdb7dab2df	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-02 00:00:00	553.82	USD	694.83	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
c10ffa81-2c4f-4886-b784-8689f145fab8	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-03 00:00:00	554.63	USD	976.30	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
f0aff11b-fab9-4160-9a7f-49129a3775fa	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-04 00:00:00	567.73	USD	941.13	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
8ee82c19-545b-456e-9b53-0959f7bbc97d	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-05 00:00:00	566.78	USD	670.49	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
bcfa02ee-09c8-483a-8aed-f20e3ff10d3b	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-06 00:00:00	582.08	USD	923.81	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
26f448c3-002f-40d7-88d7-ea5c4abe9eb1	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-07 00:00:00	547.91	USD	747.09	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
4f0d94c0-d554-45dd-8cbc-c882347dae22	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-08 00:00:00	549.04	USD	812.87	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
16630bfc-7c8a-430e-b9fa-28300b382adf	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-09 00:00:00	557.07	USD	911.77	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
5002e8c1-f252-4ee1-8912-b074f6f443ad	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-10 00:00:00	581.15	USD	947.36	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
29626553-b33a-41ff-af43-4245d1c2deb7	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-11 00:00:00	575.17	USD	945.33	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
c064d40e-f756-46ad-8e68-664f222a4900	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-12 00:00:00	559.43	USD	643.04	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
8906a168-a65b-436c-9d39-d84a700b3062	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-13 00:00:00	564.13	USD	792.30	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
fc3323a5-ff52-419d-837f-01f6f066cd88	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-14 00:00:00	549.19	USD	920.99	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
2b0393f8-73ea-4338-87d9-699ef3437336	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-15 00:00:00	565.25	USD	625.67	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
e15e931d-96b8-4f3c-b5af-43564178becc	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-16 00:00:00	577.38	USD	792.72	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
0cc16d0e-68ae-46c0-9954-eac38c0e4cf2	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-17 00:00:00	540.47	USD	931.81	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
e7f8c33d-7cfb-4eca-8327-94ac315ec784	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-18 00:00:00	561.00	USD	516.56	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
6a9ee0db-fbc3-4dfd-92d5-3304baafc816	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-19 00:00:00	559.68	USD	577.37	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
c57b9000-169d-4ff9-8b19-2a569fb8d5f7	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-20 00:00:00	581.44	USD	661.78	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
c34c673b-3930-46a2-bbb4-ac20149dd1bc	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-21 00:00:00	588.41	USD	878.50	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
5ac6a1c8-1538-445f-8cda-1c8b78096765	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-22 00:00:00	549.74	USD	878.85	USD/ton	{"source": "seed", "quality": "synthetic"}	t	2025-09-22 18:56:14.538824	\N	api	\N	\N	\N
\.


--
-- Data for Name: prices_verified; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.prices_verified (id, prices_raw_id, source_id, commodity_id, region_id, date, price, price_usd, currency, volume, quality_score, verification_method, outlier_flag, adjustments, verified_by, verified_at, created_at, openai_score, gemini_score, consensus_score, agreement_level, verification_evidence, coop_id) FROM stdin;
d9dc657b-962e-41e5-824b-fb289dfe23f7	5e6b2f61-5fff-4848-9aad-c8008431e22a	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-09 00:00:00	580.67	580.67	USD	613.84	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
e90536b1-b02b-4c09-9544-a6333d4d4ff2	62df0bc1-be73-496e-a605-8aa0c7e7cda6	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-10 00:00:00	596.60	596.60	USD	576.63	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
314b64a6-80e6-4b91-a3e8-8bdc34be3910	48631f50-1f06-4366-ba75-b533cfd157ff	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-11 00:00:00	552.77	552.77	USD	537.44	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
d0d6c48b-4aa0-42cf-a5d8-ca5923ae3078	d703f91e-100d-4b99-b703-24a9be948b40	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-12 00:00:00	565.84	565.84	USD	819.20	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
709555c7-4b38-495e-aba9-62a21e7d5720	e92bba9f-fc99-42ab-9c42-c4737e4568aa	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-13 00:00:00	555.65	555.65	USD	922.87	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
bead584d-ad6c-4e3d-bb73-c1ad0aa86646	167abf08-0cfe-459f-af56-099fcc4bfa59	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-14 00:00:00	559.52	559.52	USD	539.83	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
fbcfce8e-c549-481d-a647-9b8bb7876147	a1f67048-4c57-4039-b96e-1b9b283188be	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-15 00:00:00	595.78	595.78	USD	681.81	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
4d2f5f5c-8800-4165-bccc-08a96481b0fc	3d2da61d-29c3-49a8-b839-083a3af16624	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-16 00:00:00	570.25	570.25	USD	752.56	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
6cc7c420-aaa3-4e3e-a36c-e152856beb98	04912b9b-4451-4904-bef2-d1b2eaad717a	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-17 00:00:00	550.98	550.98	USD	901.93	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
2cd91239-0fdd-46a6-a51a-be874c63ffee	d0624932-3246-44b2-b0f8-61eef2362661	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-18 00:00:00	566.29	566.29	USD	923.66	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
86de90e5-b951-4c11-8001-953b54deb57b	00cec3fb-406d-4725-ace1-74e0392f2574	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-19 00:00:00	560.58	560.58	USD	884.81	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
495cddf3-6e20-4225-aa43-0dc2030bd49b	c716b260-3bda-4f38-a19c-baab8038967f	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-20 00:00:00	590.27	590.27	USD	670.17	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
d31b5198-c53e-426f-bd51-cc8f1f749fff	3279ec80-438b-4f67-b834-d076653f6bd3	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-21 00:00:00	553.81	553.81	USD	701.18	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
49b905eb-1bdc-4e02-9862-d7fccbc72f64	6b207879-af7d-4c15-a4db-437ee24fb79c	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-22 00:00:00	559.22	559.22	USD	779.38	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
84cf3649-5b93-4ff4-b352-11fccc6576e2	13371551-5f75-418a-a46c-5b6897620ca3	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-23 00:00:00	595.42	595.42	USD	545.53	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
28c9b007-ad7b-480f-aab5-704ebb5fb451	0dc76115-e2b7-4a65-965c-2df7410c6e52	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-24 00:00:00	583.06	583.06	USD	947.80	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
dbb1ef18-827b-4308-9ab2-e4b373823b5c	ee88a384-7200-40e6-88d8-48c955a30378	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-25 00:00:00	595.22	595.22	USD	933.88	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
a5fe7d63-ead8-43a3-8d3a-be2b9ba6748c	f371cddb-d8c2-4f9e-a169-e7a56f5f3475	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-26 00:00:00	565.35	565.35	USD	807.45	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
b8445d78-2a74-4695-9468-032df0bf0c4d	90b924eb-ef1e-4200-97de-0d4e80d61bf2	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-27 00:00:00	551.92	551.92	USD	920.89	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
f60399ff-b27a-4a8f-951a-d194adabc3d2	e716305e-7e97-4119-aca8-89a3c8d06003	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-28 00:00:00	571.08	571.08	USD	990.90	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
3c35685f-8a97-4520-9bdb-fac260790df0	1edb0b99-03e4-44ab-909b-56523c7b809e	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-29 00:00:00	588.04	588.04	USD	625.29	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
d9007b7e-e53e-4c6f-9ee6-dd390d534509	71bd84e0-5aba-4743-9022-5cf49d1396d0	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-30 00:00:00	583.43	583.43	USD	932.14	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
9875a4e6-be39-4bbd-8ca3-cd977e740bc5	5b684596-c0e7-41a1-b844-2b56373535ec	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-07-31 00:00:00	558.72	558.72	USD	663.14	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
c76db71e-19c0-4412-8e8d-52c8edff0465	718f4e36-4466-40f6-9107-a98c50da8570	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-01 00:00:00	561.21	561.21	USD	627.80	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
052f4ebc-94c1-4f87-bc11-2379b6a131ff	89f2cac1-beea-43b5-8192-9dd279ee6bed	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-02 00:00:00	584.18	584.18	USD	733.17	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
64e1b7cd-a28e-40e2-bad7-b1536952cd04	a1458e66-dc5a-4ccb-8f2f-86066c256e6f	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-03 00:00:00	562.03	562.03	USD	804.52	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
3544be30-03b2-4177-b742-3e1ee627abea	8233992f-5abc-4217-aab7-4bc4f067f620	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-04 00:00:00	577.05	577.05	USD	805.31	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
2cd18a00-79c6-4f14-b31a-fda3b9f60dce	1c641316-d0db-44c6-8db7-e7d23a0c6e17	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-05 00:00:00	585.42	585.42	USD	649.71	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
54fc2ef2-252c-427f-9e39-7973ba1b2d29	11eb1513-f02d-415f-b7e7-ec867df2817f	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-06 00:00:00	587.31	587.31	USD	872.64	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
fc629839-a67a-4a52-9483-e6ac60f84359	0346f07a-9ffc-4f0a-b302-20060208073d	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-07 00:00:00	564.42	564.42	USD	898.83	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
063950fe-0524-4e63-8bb8-e987a35945d9	011f78ac-b8f3-4d62-8f34-42091cb9471d	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-08 00:00:00	586.78	586.78	USD	979.90	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
abafc1fd-e4c0-4977-a480-b79b32779cbd	14eacdda-9282-4cdf-ac98-165765b687df	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-09 00:00:00	564.85	564.85	USD	505.22	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
5d47326d-2ff9-4c86-98f6-275d0bf80bf1	004beb6f-4852-48dd-8c14-e78ca32b817d	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-10 00:00:00	563.85	563.85	USD	629.73	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
5c085fc8-da11-4e1f-a4a6-02f278782b92	cabeb266-359e-426b-8fb8-fc91603f85dd	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-11 00:00:00	568.81	568.81	USD	761.90	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
d26420ff-9d48-4343-a242-404062afdf10	bf4bcbd5-2c19-4613-9163-d959cf535ae3	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-12 00:00:00	556.51	556.51	USD	637.45	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
f2253e05-ae4d-47f4-a7d4-a57519d8fd5b	aed1fe81-64d8-45ad-86dc-3119b17ccd39	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-13 00:00:00	548.02	548.02	USD	563.06	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
2fdcd16e-6aeb-44ae-a388-9418e7e54912	694cd27f-de00-448d-9588-f2b83a310ad7	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-14 00:00:00	588.67	588.67	USD	799.45	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
cade6cee-957d-4e2c-afb0-a17e404e32af	517e7d84-2b5e-4034-9ae6-c1caffa214a5	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-15 00:00:00	579.87	579.87	USD	924.64	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
d5a2e398-7c5f-409f-adf1-3e5fae25e2bd	62cfb0e1-9e87-4e2a-9105-3a3afac37ccf	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-16 00:00:00	547.76	547.76	USD	614.46	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
f960ffec-b788-48b7-a710-e9a646d6f3a7	1275bac5-501b-4283-8a07-d1d820eeb90c	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-17 00:00:00	570.23	570.23	USD	605.93	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
e910c446-d1f7-4424-b6c8-fd8fc1b50828	8be91ee6-dd68-4fbf-9bd0-c4750b3669c1	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-18 00:00:00	554.54	554.54	USD	898.36	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
099a411a-23db-4df9-a457-371d3ad27fff	7d1629d8-d98c-4125-b583-38d2e440f3b1	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-19 00:00:00	553.43	553.43	USD	621.81	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
78930eb7-10b5-4731-88c5-8610d00ec7d0	83d220a8-63a8-4193-9554-cbe280cfe7da	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-20 00:00:00	556.51	556.51	USD	816.72	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
4225f632-fe26-4f6e-8db3-3050fa0fe4f1	171a3c3d-d44e-4ddb-9e98-0ec543fbf0d3	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-21 00:00:00	575.02	575.02	USD	979.70	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
7cc70b13-28a6-487c-91f6-635c353487c5	5c057ba0-fd6b-464c-aab7-2210f681d241	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-22 00:00:00	568.19	568.19	USD	644.33	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
6c4dfc9a-bada-4c91-9438-b42102184a4f	9c054194-a26e-4e38-93f8-311a4a5845d7	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-23 00:00:00	573.35	573.35	USD	808.00	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
2b8c104d-fc00-43d5-b154-db9eae08c9b5	9c9916ef-7bcc-49fb-a223-70dc5f9c52ee	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-24 00:00:00	569.54	569.54	USD	729.50	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
c25bd551-1cab-448c-9336-45f383dd7e74	853fab6a-b5bf-4abf-a8eb-bc4646afca8d	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-25 00:00:00	570.95	570.95	USD	653.19	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
5cfec5dd-e85f-4d42-ba26-2578365cae87	b0eb4df4-6935-4965-84a9-76ee0e6228e7	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-26 00:00:00	556.71	556.71	USD	612.25	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
53b8b68a-0251-407e-acb5-d38de9c0268e	b08be896-9a9d-449b-b471-10b8648d7255	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-27 00:00:00	571.74	571.74	USD	621.97	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
dec52727-4434-49f9-8da9-b5ca35d9cf69	91dcb457-b42b-4b97-a336-c320e9aa9f3a	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-28 00:00:00	553.69	553.69	USD	747.84	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
16fb8688-68e7-477d-95ee-dffbe44e3604	93d11396-a66d-4667-b1ea-43209ec73c20	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-29 00:00:00	579.56	579.56	USD	502.11	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
d66b7a7a-8c3b-4a3e-8ef2-0f193031167d	53a25593-8871-40dc-acb0-8aa40d5ab711	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-30 00:00:00	545.15	545.15	USD	692.24	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
98f9d6cd-793a-48fa-9536-592971567822	f33867f0-9e89-4a3c-bdef-54d3be249d3d	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-08-31 00:00:00	578.89	578.89	USD	674.23	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
e1d8d47f-9ba4-4625-9187-3dda60f380d2	b94f8db2-81b8-49bf-b8db-4255cbf88bbd	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-01 00:00:00	588.65	588.65	USD	853.07	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
ffa338f9-aa5b-4ab7-af7b-e024795257dd	32904a27-5b66-4211-8b0c-0cfdb7dab2df	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-02 00:00:00	553.82	553.82	USD	694.83	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
db991008-853c-4e26-aeb6-6587cfd5f6f2	c10ffa81-2c4f-4886-b784-8689f145fab8	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-03 00:00:00	554.63	554.63	USD	976.30	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
ced89dc8-4aad-458c-baf4-b322b33cb0c5	f0aff11b-fab9-4160-9a7f-49129a3775fa	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-04 00:00:00	567.73	567.73	USD	941.13	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
44f968ef-5983-4350-87ee-dac41b591566	8ee82c19-545b-456e-9b53-0959f7bbc97d	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-05 00:00:00	566.78	566.78	USD	670.49	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
a3533579-fd30-4e3b-9dac-721100b7e5e5	bcfa02ee-09c8-483a-8aed-f20e3ff10d3b	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-06 00:00:00	582.08	582.08	USD	923.81	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
11f5551e-579f-41fb-849e-701633e41b73	26f448c3-002f-40d7-88d7-ea5c4abe9eb1	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-07 00:00:00	547.91	547.91	USD	747.09	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
c7ff569c-a633-4fdf-b2de-cffb271df717	4f0d94c0-d554-45dd-8cbc-c882347dae22	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-08 00:00:00	549.04	549.04	USD	812.87	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
18dc24a4-60c9-4963-90bd-793ab6faa3a2	16630bfc-7c8a-430e-b9fa-28300b382adf	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-09 00:00:00	557.07	557.07	USD	911.77	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
fcf8f51c-de39-47c8-a601-747f33526ae3	5002e8c1-f252-4ee1-8912-b074f6f443ad	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-10 00:00:00	581.15	581.15	USD	947.36	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
d775bea4-37ed-43fb-a893-eabc49cfdf4d	29626553-b33a-41ff-af43-4245d1c2deb7	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-11 00:00:00	575.17	575.17	USD	945.33	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
c754eb31-3434-48e9-8719-71f8b3df90b3	c064d40e-f756-46ad-8e68-664f222a4900	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-12 00:00:00	559.43	559.43	USD	643.04	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
2abeeef7-87c2-4546-940e-3f1e9185d096	8906a168-a65b-436c-9d39-d84a700b3062	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-13 00:00:00	564.13	564.13	USD	792.30	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
a52fe670-8d71-4a77-8fab-f203edaa22e4	fc3323a5-ff52-419d-837f-01f6f066cd88	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-14 00:00:00	549.19	549.19	USD	920.99	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
da05f536-7096-4edb-9c9f-75c73484c710	2b0393f8-73ea-4338-87d9-699ef3437336	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-15 00:00:00	565.25	565.25	USD	625.67	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
c6408aaf-04fe-4efe-9ad0-d32cd16f8530	e15e931d-96b8-4f3c-b5af-43564178becc	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-16 00:00:00	577.38	577.38	USD	792.72	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
a805dc33-a995-4357-af02-391ae71e9fd5	0cc16d0e-68ae-46c0-9954-eac38c0e4cf2	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-17 00:00:00	540.47	540.47	USD	931.81	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
bf850bad-c865-4c6e-9000-2dfa85e7bde7	e7f8c33d-7cfb-4eca-8327-94ac315ec784	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-18 00:00:00	561.00	561.00	USD	516.56	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
45e1ed3a-ec3a-4d7f-97e2-447773c80534	6a9ee0db-fbc3-4dfd-92d5-3304baafc816	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-19 00:00:00	559.68	559.68	USD	577.37	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
7c12c6c8-1869-4de1-861b-9b73b3eaceaa	c57b9000-169d-4ff9-8b19-2a569fb8d5f7	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-20 00:00:00	581.44	581.44	USD	661.78	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
b17f5bb1-0e62-402d-9461-7a8ed2a53b00	c34c673b-3930-46a2-bbb4-ac20149dd1bc	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-21 00:00:00	588.41	588.41	USD	878.50	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
20754d4d-d16c-4735-8726-430b20ae72c7	5ac6a1c8-1538-445f-8cda-1c8b78096765	seed-source-001	d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a	9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	2025-09-22 00:00:00	549.74	549.74	USD	878.85	0.95	automatic	f	\N	system	2025-09-22 18:56:32.120564	2025-09-22 18:56:32.120564	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: profiles; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.profiles (id, user_id, default_coop_id, full_name, phone_number, preferred_language, timezone, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: quality_gates; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.quality_gates (id, ccs_id, forecast_run_id, gate_status, confidence_level, threshold, publish_decision, published_at, manual_override, override_reason, override_by, override_at, ui_indicator, warning_message, quality_metrics, created_at, coop_id) FROM stdin;
\.


--
-- Data for Name: regions; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.regions (id, name, country, timezone) FROM stdin;
9a58ba92-aed1-4f7e-9cb3-9cdec573c09a	Vietnam	Vietnam	Asia/Ho_Chi_Minh
81d09c85-6421-43c6-85d2-7dc602f39153	World	Global	UTC
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.roles (id, name, display_name, description, permissions, is_active, created_at) FROM stdin;
\.


--
-- Data for Name: session; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.session (sid, sess, expire) FROM stdin;
PUPJaIxNt3EdvCxR90IhqTLmH08zZpuU	{"cookie":{"originalMaxAge":86400000,"expires":"2025-09-26T17:40:54.349Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"passport":{"user":"d88d2a4f-9843-448f-87ab-08d78886a9aa"}}	2025-09-27 07:52:59
\.


--
-- Data for Name: sources; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.sources (id, name, type, url, frequency, reliability, api_key, is_active, metadata, last_sync, created_at, coop_id) FROM stdin;
seed-source-001	Historical Data Seeder	manual	\N	daily	1.00	\N	t	{"purpose": "seed_data"}	\N	2025-09-22 18:55:37.641113	\N
\.


--
-- Data for Name: trading_recommendations; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.trading_recommendations (id, forecast_id, action, confidence, entry_price, target_price, stop_loss, risk_level, reasoning, metadata, created_at, coop_id) FROM stdin;
cc695196-ed8e-492c-b05b-2567031c4235	9d17896a-72dc-4851-8154-b210da33322a	hold	0.75	2387.16	2651.04	2526.52	low	Price movements within normal range. Monitor for trend confirmation.	{"volatility": 0.2047988713863238, "horizonDays": 30, "priceChange": -0.3177300911076868}	2025-09-22 15:26:46.202659	\N
0bbf3675-e4ac-42e3-ab7f-c2f3456609be	be299cc6-e62f-42fd-88e5-dea93b0049a2	hold	0.74	2427.52	2711.83	2569.23	low	Price movements within normal range. Monitor for trend confirmation.	{"volatility": 0.20480266093376073, "horizonDays": 15, "priceChange": 0.2728835807650395}	2025-09-22 15:30:05.714823	\N
b5260226-bed7-4c83-836f-9e5fd4154021	604d6904-ddc6-4407-873c-c8250c7843cc	hold	0.75	530.18	590.77	561.13	low	Price movements within normal range. Monitor for trend confirmation.	{"volatility": 0.20480051458266332, "horizonDays": 30, "priceChange": 0.01862323502522833}	2025-09-22 15:35:38.61494	\N
efa6396e-464d-4828-96f0-17b3cd6253d5	56db8583-575d-4c08-8b8e-1ff5b0763aad	hold	0.75	539.57	578.79	571.07	low	Price movements within normal range. Monitor for trend confirmation.	{"volatility": 0.20480657924290324, "horizonDays": 30, "priceChange": -3.7163342371866372}	2025-09-22 15:37:17.110001	\N
c5745ec1-a2c5-48b6-bfba-ccabc2cf63b7	d80fe59c-3521-4b32-9520-681b9e23c9bf	hold	0.75	531.03	579.56	562.03	low	Price movements within normal range. Monitor for trend confirmation.	{"volatility": 0.20481054593139614, "horizonDays": 30, "priceChange": -2.036814793529533}	2025-09-22 15:40:18.98542	\N
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.users (id, username, password) FROM stdin;
dc549261-2e47-4046-8b78-8d8fb3366a7a	testuser123	28b6b3d41daa27758066440c46c6289ed417808c6e64234743c56017bed63e145db2fca2033a6addb6c51260733dbdcb11db1ce3074776ad4b761e7c318d6f5c.8613e0ac8c6020179addd6d1b0cee645
8dfd17f3-7e74-4c3f-b89c-e8e26f22a955	testuser456	5ea8c8c827beb3ac1d847629e6c4891a6b540e64bcb0996e85f29093b92d3e4b96e6e70725772890bef9bb06caba06deba494ca274feeabb783bb4e0c6672207.d07fd9868118eb1541e2dc9d0baf73cc
61f5f44a-c2b6-41be-86da-ca5a336eb09c	newtestuser	374345ccc8223aa88de829334612aae0c609b096c4c25d59aebe2fa896f44ba2e2fce2a5c46e70a00b73ddef7bda814b375a73071f60f7aacf1a958e5cced8ef.bbda652c11b1aac89435781fd8898309
ba037e42-de89-4174-aefb-e61860afed66	finaltest	3b04574ca7f7a107a7610acea389a2c5ec7679216a7da8ad72b7f282555c3b159e89510b8b58e309562032acbebffd8370ffcf10be5954b76dcb32933ac7e477.2891f8ccb0c91601b0aff23edfb83c49
d88d2a4f-9843-448f-87ab-08d78886a9aa	gacon2222212112@	d71a48608045316625d13f330f72155b784c7edf2a3a76da3696364d82baf872011cb53a1c6a40f6efc0c03360d5ebf2fa8430cee749f064fd7b213453293094.92b21ad81bff3320f5849f591e6b862e
\.


--
-- Name: agreement_analysis agreement_analysis_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.agreement_analysis
    ADD CONSTRAINT agreement_analysis_pkey PRIMARY KEY (id);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);


--
-- Name: commodities commodities_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.commodities
    ADD CONSTRAINT commodities_pkey PRIMARY KEY (id);


--
-- Name: commodities commodities_slug_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.commodities
    ADD CONSTRAINT commodities_slug_unique UNIQUE (slug);


--
-- Name: composite_confidence_scores composite_confidence_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.composite_confidence_scores
    ADD CONSTRAINT composite_confidence_scores_pkey PRIMARY KEY (id);


--
-- Name: cooperative_members cooperative_members_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.cooperative_members
    ADD CONSTRAINT cooperative_members_pkey PRIMARY KEY (id);


--
-- Name: cooperatives cooperatives_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.cooperatives
    ADD CONSTRAINT cooperatives_pkey PRIMARY KEY (id);


--
-- Name: cooperatives cooperatives_slug_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.cooperatives
    ADD CONSTRAINT cooperatives_slug_key UNIQUE (slug);


--
-- Name: evidence evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_pkey PRIMARY KEY (id);


--
-- Name: export_audit export_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.export_audit
    ADD CONSTRAINT export_audit_pkey PRIMARY KEY (id);


--
-- Name: forecast_runs forecast_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.forecast_runs
    ADD CONSTRAINT forecast_runs_pkey PRIMARY KEY (id);


--
-- Name: forecasts_30d forecasts_30d_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.forecasts_30d
    ADD CONSTRAINT forecasts_30d_pkey PRIMARY KEY (id);


--
-- Name: forecasts forecasts_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.forecasts
    ADD CONSTRAINT forecasts_pkey PRIMARY KEY (id);


--
-- Name: fx_rates fx_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.fx_rates
    ADD CONSTRAINT fx_rates_pkey PRIMARY KEY (id);


--
-- Name: llm_verifications llm_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.llm_verifications
    ADD CONSTRAINT llm_verifications_pkey PRIMARY KEY (id);


--
-- Name: price_data price_data_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.price_data
    ADD CONSTRAINT price_data_pkey PRIMARY KEY (id);


--
-- Name: prices_raw prices_raw_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.prices_raw
    ADD CONSTRAINT prices_raw_pkey PRIMARY KEY (id);


--
-- Name: prices_verified prices_verified_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.prices_verified
    ADD CONSTRAINT prices_verified_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);


--
-- Name: quality_gates quality_gates_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.quality_gates
    ADD CONSTRAINT quality_gates_pkey PRIMARY KEY (id);


--
-- Name: regions regions_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (id);


--
-- Name: roles roles_name_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_unique UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: sources sources_name_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_name_unique UNIQUE (name);


--
-- Name: sources sources_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (id);


--
-- Name: trading_recommendations trading_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.trading_recommendations
    ADD CONSTRAINT trading_recommendations_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_unique UNIQUE (username);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX "IDX_session_expire" ON public.session USING btree (expire);


--
-- Name: idx_agreement_analysis_ccs; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_agreement_analysis_ccs ON public.agreement_analysis USING btree (ccs_id);


--
-- Name: idx_agreement_analysis_gemini; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_agreement_analysis_gemini ON public.agreement_analysis USING btree (gemini_verification_id);


--
-- Name: idx_agreement_analysis_openai; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_agreement_analysis_openai ON public.agreement_analysis USING btree (openai_verification_id);


--
-- Name: idx_agreement_analysis_semantic; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_agreement_analysis_semantic ON public.agreement_analysis USING btree (semantic_similarity);


--
-- Name: idx_alerts_coop; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_alerts_coop ON public.alerts USING btree (coop_id);


--
-- Name: idx_ccs_commodity_region; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ccs_commodity_region ON public.composite_confidence_scores USING btree (commodity_id, region_id);


--
-- Name: idx_ccs_composite_score; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ccs_composite_score ON public.composite_confidence_scores USING btree (composite_score);


--
-- Name: idx_ccs_created_at; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ccs_created_at ON public.composite_confidence_scores USING btree (created_at);


--
-- Name: idx_ccs_forecast_30d; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ccs_forecast_30d ON public.composite_confidence_scores USING btree (forecast_30d_id);


--
-- Name: idx_ccs_forecast_run; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ccs_forecast_run ON public.composite_confidence_scores USING btree (forecast_run_id);


--
-- Name: idx_commodities_slug; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_commodities_slug ON public.commodities USING btree (slug);


--
-- Name: idx_evidence_commodity_region; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_evidence_commodity_region ON public.evidence USING btree (commodity_id, region_id);


--
-- Name: idx_evidence_confidence; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_evidence_confidence ON public.evidence USING btree (confidence);


--
-- Name: idx_evidence_published_at; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_evidence_published_at ON public.evidence USING btree (published_at);


--
-- Name: idx_evidence_type; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_evidence_type ON public.evidence USING btree (type);


--
-- Name: idx_forecast_runs_commodity_region_run_date; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_forecast_runs_commodity_region_run_date ON public.forecast_runs USING btree (commodity_id, region_id, run_date);


--
-- Name: idx_forecast_runs_run_date; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_forecast_runs_run_date ON public.forecast_runs USING btree (run_date);


--
-- Name: idx_forecast_runs_status; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_forecast_runs_status ON public.forecast_runs USING btree (status);


--
-- Name: idx_forecasts_30d_commodity_region_forecast_date; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_forecasts_30d_commodity_region_forecast_date ON public.forecasts_30d USING btree (commodity_id, region_id, forecast_date);


--
-- Name: idx_forecasts_30d_days_ahead; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_forecasts_30d_days_ahead ON public.forecasts_30d USING btree (days_ahead);


--
-- Name: idx_forecasts_30d_forecast_run; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_forecasts_30d_forecast_run ON public.forecasts_30d USING btree (forecast_run_id);


--
-- Name: idx_forecasts_30d_target_date; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_forecasts_30d_target_date ON public.forecasts_30d USING btree (target_date);


--
-- Name: idx_fx_rates_currency_pair_date; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_fx_rates_currency_pair_date ON public.fx_rates USING btree (base_currency, target_currency, date);


--
-- Name: idx_fx_rates_date; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_fx_rates_date ON public.fx_rates USING btree (date);


--
-- Name: idx_prices_raw_commodity_region_date; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_prices_raw_commodity_region_date ON public.prices_raw USING btree (commodity_id, region_id, date);


--
-- Name: idx_prices_raw_date; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_prices_raw_date ON public.prices_raw USING btree (date);


--
-- Name: idx_prices_raw_source; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_prices_raw_source ON public.prices_raw USING btree (source_id);


--
-- Name: idx_prices_verified_commodity_region_date; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_prices_verified_commodity_region_date ON public.prices_verified USING btree (commodity_id, region_id, date);


--
-- Name: idx_prices_verified_date; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_prices_verified_date ON public.prices_verified USING btree (date);


--
-- Name: idx_prices_verified_quality; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_prices_verified_quality ON public.prices_verified USING btree (quality_score);


--
-- Name: idx_prices_verified_source; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_prices_verified_source ON public.prices_verified USING btree (source_id);


--
-- Name: idx_quality_gates_ccs; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_quality_gates_ccs ON public.quality_gates USING btree (ccs_id);


--
-- Name: idx_quality_gates_confidence; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_quality_gates_confidence ON public.quality_gates USING btree (confidence_level);


--
-- Name: idx_quality_gates_created_at; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_quality_gates_created_at ON public.quality_gates USING btree (created_at);


--
-- Name: idx_quality_gates_forecast_run; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_quality_gates_forecast_run ON public.quality_gates USING btree (forecast_run_id);


--
-- Name: idx_quality_gates_manual_override; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_quality_gates_manual_override ON public.quality_gates USING btree (manual_override);


--
-- Name: idx_quality_gates_publish_decision; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_quality_gates_publish_decision ON public.quality_gates USING btree (publish_decision);


--
-- Name: idx_quality_gates_status; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_quality_gates_status ON public.quality_gates USING btree (gate_status);


--
-- Name: agreement_analysis agreement_analysis_ccs_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.agreement_analysis
    ADD CONSTRAINT agreement_analysis_ccs_id_fkey FOREIGN KEY (ccs_id) REFERENCES public.composite_confidence_scores(id) ON DELETE CASCADE;


--
-- Name: agreement_analysis agreement_analysis_gemini_verification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.agreement_analysis
    ADD CONSTRAINT agreement_analysis_gemini_verification_id_fkey FOREIGN KEY (gemini_verification_id) REFERENCES public.llm_verifications(id) ON DELETE SET NULL;


--
-- Name: agreement_analysis agreement_analysis_openai_verification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.agreement_analysis
    ADD CONSTRAINT agreement_analysis_openai_verification_id_fkey FOREIGN KEY (openai_verification_id) REFERENCES public.llm_verifications(id) ON DELETE SET NULL;


--
-- Name: alerts alerts_commodity_id_commodities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_commodity_id_commodities_id_fk FOREIGN KEY (commodity_id) REFERENCES public.commodities(id);


--
-- Name: alerts alerts_coop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_coop_id_fkey FOREIGN KEY (coop_id) REFERENCES public.cooperatives(id) ON DELETE CASCADE;


--
-- Name: alerts alerts_region_id_regions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_region_id_regions_id_fk FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: composite_confidence_scores composite_confidence_scores_commodity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.composite_confidence_scores
    ADD CONSTRAINT composite_confidence_scores_commodity_id_fkey FOREIGN KEY (commodity_id) REFERENCES public.commodities(id) ON DELETE CASCADE;


--
-- Name: composite_confidence_scores composite_confidence_scores_forecast_30d_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.composite_confidence_scores
    ADD CONSTRAINT composite_confidence_scores_forecast_30d_id_fkey FOREIGN KEY (forecast_30d_id) REFERENCES public.forecasts_30d(id) ON DELETE CASCADE;


--
-- Name: composite_confidence_scores composite_confidence_scores_forecast_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.composite_confidence_scores
    ADD CONSTRAINT composite_confidence_scores_forecast_run_id_fkey FOREIGN KEY (forecast_run_id) REFERENCES public.forecast_runs(id) ON DELETE CASCADE;


--
-- Name: composite_confidence_scores composite_confidence_scores_region_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.composite_confidence_scores
    ADD CONSTRAINT composite_confidence_scores_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE CASCADE;


--
-- Name: cooperative_members cooperative_members_coop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.cooperative_members
    ADD CONSTRAINT cooperative_members_coop_id_fkey FOREIGN KEY (coop_id) REFERENCES public.cooperatives(id) ON DELETE CASCADE;


--
-- Name: evidence evidence_commodity_id_commodities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_commodity_id_commodities_id_fk FOREIGN KEY (commodity_id) REFERENCES public.commodities(id);


--
-- Name: evidence evidence_forecast_id_forecasts_30d_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_forecast_id_forecasts_30d_id_fk FOREIGN KEY (forecast_id) REFERENCES public.forecasts_30d(id);


--
-- Name: evidence evidence_region_id_regions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_region_id_regions_id_fk FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: evidence evidence_source_id_sources_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_source_id_sources_id_fk FOREIGN KEY (source_id) REFERENCES public.sources(id);


--
-- Name: evidence evidence_verification_id_llm_verifications_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_verification_id_llm_verifications_id_fk FOREIGN KEY (verification_id) REFERENCES public.llm_verifications(id);


--
-- Name: export_audit export_audit_coop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.export_audit
    ADD CONSTRAINT export_audit_coop_id_fkey FOREIGN KEY (coop_id) REFERENCES public.cooperatives(id) ON DELETE CASCADE;


--
-- Name: forecast_runs forecast_runs_commodity_id_commodities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.forecast_runs
    ADD CONSTRAINT forecast_runs_commodity_id_commodities_id_fk FOREIGN KEY (commodity_id) REFERENCES public.commodities(id);


--
-- Name: forecast_runs forecast_runs_region_id_regions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.forecast_runs
    ADD CONSTRAINT forecast_runs_region_id_regions_id_fk FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: forecasts_30d forecasts_30d_commodity_id_commodities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.forecasts_30d
    ADD CONSTRAINT forecasts_30d_commodity_id_commodities_id_fk FOREIGN KEY (commodity_id) REFERENCES public.commodities(id);


--
-- Name: forecasts_30d forecasts_30d_forecast_run_id_forecast_runs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.forecasts_30d
    ADD CONSTRAINT forecasts_30d_forecast_run_id_forecast_runs_id_fk FOREIGN KEY (forecast_run_id) REFERENCES public.forecast_runs(id);


--
-- Name: forecasts_30d forecasts_30d_region_id_regions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.forecasts_30d
    ADD CONSTRAINT forecasts_30d_region_id_regions_id_fk FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: forecasts forecasts_commodity_id_commodities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.forecasts
    ADD CONSTRAINT forecasts_commodity_id_commodities_id_fk FOREIGN KEY (commodity_id) REFERENCES public.commodities(id);


--
-- Name: forecasts forecasts_region_id_regions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.forecasts
    ADD CONSTRAINT forecasts_region_id_regions_id_fk FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: fx_rates fx_rates_source_id_sources_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.fx_rates
    ADD CONSTRAINT fx_rates_source_id_sources_id_fk FOREIGN KEY (source_id) REFERENCES public.sources(id);


--
-- Name: llm_verifications llm_verifications_forecast_id_forecasts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.llm_verifications
    ADD CONSTRAINT llm_verifications_forecast_id_forecasts_id_fk FOREIGN KEY (forecast_id) REFERENCES public.forecasts(id);


--
-- Name: price_data price_data_commodity_id_commodities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.price_data
    ADD CONSTRAINT price_data_commodity_id_commodities_id_fk FOREIGN KEY (commodity_id) REFERENCES public.commodities(id);


--
-- Name: price_data price_data_region_id_regions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.price_data
    ADD CONSTRAINT price_data_region_id_regions_id_fk FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: prices_raw prices_raw_commodity_id_commodities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.prices_raw
    ADD CONSTRAINT prices_raw_commodity_id_commodities_id_fk FOREIGN KEY (commodity_id) REFERENCES public.commodities(id);


--
-- Name: prices_raw prices_raw_region_id_regions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.prices_raw
    ADD CONSTRAINT prices_raw_region_id_regions_id_fk FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: prices_raw prices_raw_source_id_sources_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.prices_raw
    ADD CONSTRAINT prices_raw_source_id_sources_id_fk FOREIGN KEY (source_id) REFERENCES public.sources(id);


--
-- Name: prices_verified prices_verified_commodity_id_commodities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.prices_verified
    ADD CONSTRAINT prices_verified_commodity_id_commodities_id_fk FOREIGN KEY (commodity_id) REFERENCES public.commodities(id);


--
-- Name: prices_verified prices_verified_prices_raw_id_prices_raw_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.prices_verified
    ADD CONSTRAINT prices_verified_prices_raw_id_prices_raw_id_fk FOREIGN KEY (prices_raw_id) REFERENCES public.prices_raw(id);


--
-- Name: prices_verified prices_verified_region_id_regions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.prices_verified
    ADD CONSTRAINT prices_verified_region_id_regions_id_fk FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- Name: prices_verified prices_verified_source_id_sources_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.prices_verified
    ADD CONSTRAINT prices_verified_source_id_sources_id_fk FOREIGN KEY (source_id) REFERENCES public.sources(id);


--
-- Name: profiles profiles_default_coop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_default_coop_id_fkey FOREIGN KEY (default_coop_id) REFERENCES public.cooperatives(id) ON DELETE SET NULL;


--
-- Name: quality_gates quality_gates_ccs_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.quality_gates
    ADD CONSTRAINT quality_gates_ccs_id_fkey FOREIGN KEY (ccs_id) REFERENCES public.composite_confidence_scores(id) ON DELETE CASCADE;


--
-- Name: quality_gates quality_gates_forecast_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.quality_gates
    ADD CONSTRAINT quality_gates_forecast_run_id_fkey FOREIGN KEY (forecast_run_id) REFERENCES public.forecast_runs(id) ON DELETE CASCADE;


--
-- Name: trading_recommendations trading_recommendations_forecast_id_forecasts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.trading_recommendations
    ADD CONSTRAINT trading_recommendations_forecast_id_forecasts_id_fk FOREIGN KEY (forecast_id) REFERENCES public.forecasts(id);


--
-- Name: SCHEMA auth; Type: ACL; Schema: -; Owner: neondb_owner
--

GRANT USAGE ON SCHEMA auth TO PUBLIC;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO neon_superuser WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON TABLES TO neon_superuser WITH GRANT OPTION;


--
-- PostgreSQL database dump complete
--

