--
-- PostgreSQL database dump
--

\restrict UZEiWyrR22Ca3snfTbGHc9lLpNS1HyCkXJzR6OyNLNK7r5ksufJ3kROn3ucLiUY

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

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
-- Name: movement_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.movement_type AS ENUM (
    'in',
    'out'
);


ALTER TYPE public.movement_type OWNER TO postgres;

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.user_role AS ENUM (
    'admin',
    'editor',
    'viewer'
);


ALTER TYPE public.user_role OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.app_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clerk_user_id text NOT NULL,
    email text NOT NULL,
    name text,
    role public.user_role DEFAULT 'viewer'::public.user_role NOT NULL,
    editable_sections text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    phone text
);


ALTER TABLE public.app_users OWNER TO postgres;

--
-- Name: categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.categories OWNER TO postgres;

--
-- Name: clients; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    contact text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.clients OWNER TO postgres;

--
-- Name: deliveries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    site_id uuid NOT NULL,
    driver text NOT NULL,
    planned_date date NOT NULL,
    actual_date date,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.deliveries OWNER TO postgres;

--
-- Name: goods_receipt_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.goods_receipt_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    receipt_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric(12,2) NOT NULL,
    price numeric(12,2) NOT NULL
);


ALTER TABLE public.goods_receipt_items OWNER TO postgres;

--
-- Name: goods_receipts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.goods_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    doc_number text NOT NULL,
    doc_type text NOT NULL,
    total_sum numeric(14,2) NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_posted boolean DEFAULT false NOT NULL
);


ALTER TABLE public.goods_receipts OWNER TO postgres;

--
-- Name: movements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    type public.movement_type NOT NULL,
    quantity numeric(12,2) NOT NULL,
    reason text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    shipment_id uuid,
    goods_receipt_id uuid
);


ALTER TABLE public.movements OWNER TO postgres;

--
-- Name: order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric(12,2) NOT NULL,
    price numeric(12,2) NOT NULL
);


ALTER TABLE public.order_items OWNER TO postgres;

--
-- Name: order_payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.order_payments OWNER TO postgres;

--
-- Name: orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    is_paid boolean DEFAULT false NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.orders OWNER TO postgres;

--
-- Name: products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    sku text NOT NULL,
    unit text NOT NULL,
    price numeric(12,2) NOT NULL,
    category_id uuid,
    min_stock numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    supplier text,
    supplier_contact text,
    purchase_price numeric(12,2) DEFAULT '0'::numeric NOT NULL
);


ALTER TABLE public.products OWNER TO postgres;

--
-- Name: shipment_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.shipment_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric(12,2) NOT NULL
);


ALTER TABLE public.shipment_items OWNER TO postgres;

--
-- Name: shipments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.shipments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    site_id uuid NOT NULL,
    driver text NOT NULL,
    shipment_date date NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_dispatched boolean DEFAULT false NOT NULL,
    dispatched_at timestamp with time zone,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    delete_note text
);


ALTER TABLE public.shipments OWNER TO postgres;

--
-- Name: sites; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    address text NOT NULL,
    branch text NOT NULL,
    client text NOT NULL,
    manager text NOT NULL,
    director text NOT NULL,
    project text NOT NULL,
    driver text NOT NULL,
    store_area numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    customer text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.sites OWNER TO postgres;

--
-- Data for Name: app_users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.app_users (id, clerk_user_id, email, name, role, editable_sections, created_at, updated_at, phone) FROM stdin;
\.


--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.categories (id, name, created_at) FROM stdin;
8a1a1c68-4c46-422d-adaa-377e4d038bc7	Электроника	2026-07-09 08:33:07.170123+00
c72b1cd7-cf79-45eb-9872-d65d39e4d501	Канцелярия	2026-07-09 08:33:07.170123+00
66dcf37e-bc14-4482-afcf-d0828501b08f	Хозтовары	2026-07-09 08:33:07.170123+00
7e258529-0360-44f8-95f2-5abb27c14a9f	ТестКатегория1	2026-07-09 15:45:53.394499+00
6fb0406d-f462-49e6-aec7-ae611c545884	Оборудование	2026-07-09 16:01:02.820922+00
\.


--
-- Data for Name: clients; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.clients (id, name, contact, created_at) FROM stdin;
251f1510-8be2-4dfc-82b9-5986c9d88e0d	ООО Ромашка	+7 900 000-00-00	2026-07-09 11:07:28.677891+00
b2ea4c50-06a3-456f-9999-ff1f60394391	ООО Северный Ветер	+7 900 000-00-00	2026-07-09 11:07:28.786814+00
49f6fb9c-ab09-4bba-b9db-ccd5899264c8	ИП Кузнецов А.В.	+7 900 000-00-00	2026-07-09 11:07:28.806615+00
ecc4b3c3-8c70-4e63-96b4-30b3b26e2162	ООО ТехноСтрой	+7 900 000-00-00	2026-07-09 11:07:28.815017+00
10ba3275-3085-448f-9474-949f5cf60ef9	ООО Гарант Плюс	+7 900 000-00-00	2026-07-09 11:07:28.822473+00
64209819-c1a3-467a-b365-018fc9c5c617	ИП Соколова Е.И.	+7 900 000-00-00	2026-07-09 11:07:28.831622+00
4159b63b-d56f-4406-8ccb-9e986c677dbb	ООО Меридиан	+7 900 000-00-00	2026-07-09 11:07:28.846206+00
5370f62f-7b58-4beb-85ca-7829715c66f8	ООО Стройкомплект	+7 900 000-00-00	2026-07-09 11:07:28.855785+00
49dce057-28d1-4a9c-9bba-c233fca98484	ООО Альфа Трейд	+7 900 000-00-00	2026-07-09 11:07:28.868124+00
af00c6ef-3830-409c-8051-07a1b55c23e6	ИП Морозов Д.С.	+7 900 000-00-00	2026-07-09 11:07:28.87626+00
2bcb44f4-5320-4e3e-9934-db2f0d9f525a	Тест Клиент AD5f	\N	2026-07-09 13:44:08.162459+00
\.


--
-- Data for Name: deliveries; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.deliveries (id, site_id, driver, planned_date, actual_date, note, created_at) FROM stdin;
c15eb644-3f77-4a13-8a41-db374342195e	35833539-33f8-4837-abee-b2c7a9a6b84f	Сидоров С.С.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
dd206967-13dd-4b54-ae5c-568d0422d130	27abfaed-0c0a-4962-ba9d-37a969d779a9	Белов А.П.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
34214f1d-2a7d-4908-8c9f-27f5f3a6fd57	7166c0c9-2182-4e6b-a482-0b03ddc841a1	Григорьев М.С.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
aec37e23-20c0-4adb-9a75-f80dcaa05d1c	1a905e70-56c2-461d-9205-14391d2585dd	Титов Д.В.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
5706f867-e1d7-4508-b9f3-5ece8ed2bd01	b20815bc-37cc-4bbf-b39d-0168c5c52586	Захаров К.Н.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
940365c9-17a8-4862-a4a6-2b67822a9f2d	e69276e4-4752-426a-8155-e02dcfbd9f08	Кузнецов И.О.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
859f8456-61a8-492f-90c0-727b808c7b86	b694c984-aa87-430c-b5f7-071e881fd81b	Смирнов В.А.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
a207e492-975a-4137-944d-abe035728a29	f3049241-8fa9-47f6-abf2-6f8ab02ab78c	Морозов П.С.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
92a70a46-a474-4670-a2dc-1614cf201c01	c8fa3565-9350-445d-a60d-c05c4d02901e	Волков Д.Н.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
673cbed1-4ae2-412a-bd8b-549a361c942d	5e8f8138-8c02-433e-bf70-4f167fbaa8e2	Захаров К.Н.	2026-07-10	\N	\N	2026-07-09 09:44:27.530451+00
9c1cd624-9013-4d15-a8f2-c2bea5c402d4	8d604b0a-0df9-4f4b-b6be-24e5b3168954	Кузнецов И.О.	2026-07-11	\N	\N	2026-07-09 09:44:27.530451+00
4fa1e53c-ad54-4619-9f2a-ee0005dcf384	9d2420fa-05e1-4ea9-a753-f50180c62e01	Смирнов В.А.	2026-07-12	\N	\N	2026-07-09 09:44:27.530451+00
29882299-ac66-42ac-9a65-46cd85bccf95	661f0848-d690-481c-a6ab-87c16cc691d6	Соколов А.И.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
d458fceb-ccb8-4572-a64a-730904b8be6c	b20815bc-37cc-4bbf-b39d-0168c5c52586	Захаров К.Н.	2026-07-10	\N	\N	2026-07-09 09:44:27.530451+00
89246e23-9b06-4dba-9212-322c914dfe6a	e69276e4-4752-426a-8155-e02dcfbd9f08	Кузнецов И.О.	2026-07-11	\N	\N	2026-07-09 09:44:27.530451+00
ab623dc0-f320-4af6-a6ac-7fc3ebe79d68	b694c984-aa87-430c-b5f7-071e881fd81b	Смирнов В.А.	2026-07-12	\N	\N	2026-07-09 09:44:27.530451+00
dcbbd19b-203e-4829-a03a-6e9ad9f54770	87a12aa4-eb87-4b7f-8527-576ba8f18dd4	Новиков Е.В.	2026-07-10	\N	\N	2026-07-09 09:44:27.530451+00
b0a8ec29-efe3-4ba8-9a7f-38a9fcfa277b	83550092-db80-49bf-9cb5-8a44487b5abf	Белов А.П.	2026-07-11	\N	\N	2026-07-09 09:44:27.530451+00
efb495df-426b-47cb-b003-08efe429709d	35833539-33f8-4837-abee-b2c7a9a6b84f	Сидоров С.С.	2026-07-06	\N	Просрочена, требуется уточнение	2026-07-09 10:19:29.260949+00
cacbcc5d-b5c3-4053-8a70-991edb214d42	27abfaed-0c0a-4962-ba9d-37a969d779a9	Белов А.П.	2026-07-04	\N	Просрочена, требуется уточнение	2026-07-09 10:19:29.260949+00
7a91db39-455f-46f2-b234-caa5cfcb63dd	57292e3b-0267-4574-b45c-d6c1e4463ca6	Сидоров С.С.	2026-07-02	\N	Просрочена, требуется уточнение	2026-07-09 10:19:29.260949+00
4f53b260-74db-4609-a81f-23ad98a0868f	af744b55-0e73-4268-8e3e-cfec4272cccd	Григорьев М.С.	2026-06-30	\N	Просрочена, требуется уточнение	2026-07-09 10:19:29.260949+00
87a0c40d-8ed9-404f-b849-39a2a88da589	8c07137a-79ba-4efa-a578-3073d9e05cf6	Титов Д.В.	2026-06-28	\N	Просрочена, требуется уточнение	2026-07-09 10:19:29.260949+00
58d9fb11-4eba-465a-a5c0-d1c7e343a875	ecaf7d04-3d5c-4c6c-924b-84442932ea5b	Лебедев Р.М.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
c81cd245-2a6f-4f01-b926-03caba85c783	87a12aa4-eb87-4b7f-8527-576ba8f18dd4	Новиков Е.В.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
e8a04b7c-baeb-4330-bad6-09bb0093c93b	57292e3b-0267-4574-b45c-d6c1e4463ca6	Сидоров С.С.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
7ee77d83-e803-4649-b66d-ee43d6b8f5fb	83550092-db80-49bf-9cb5-8a44487b5abf	Белов А.П.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
8564d7fc-7870-4c9e-86e1-b36b52f7ece4	af744b55-0e73-4268-8e3e-cfec4272cccd	Григорьев М.С.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
abf4be86-2d8f-4b38-9cd2-09fc7cb38fa9	8c07137a-79ba-4efa-a578-3073d9e05cf6	Титов Д.В.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
08c09fab-4a37-49fd-ae4c-65e5e3405869	5e8f8138-8c02-433e-bf70-4f167fbaa8e2	Захаров К.Н.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
d9e4f008-793d-4e7b-9cfc-c94259951fb4	8d604b0a-0df9-4f4b-b6be-24e5b3168954	Кузнецов И.О.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
d2d39855-4f73-40ee-93b6-682b14132d32	9d2420fa-05e1-4ea9-a753-f50180c62e01	Смирнов В.А.	2026-07-30	\N	\N	2026-07-09 16:44:21.887388+00
de878e85-c824-4eca-af22-337435f6493e	cde5b212-96c7-4852-978f-7eb29a9db4b9	Морозов П.С.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
5bfb45ed-cae1-4725-ac5c-28046fac6dfd	128a3806-110f-4221-b18d-3230e5acbf13	Волков Д.Н.	2026-07-05	\N	\N	2026-07-09 16:44:21.887388+00
b6f7d879-134c-4277-8ca5-72c5e176a379	8300e1ec-58bf-4946-9efb-90bb415e7228	Тестов А.А.	2026-07-09	\N	\N	2026-07-09 17:22:16.702056+00
0301762f-513a-4dc9-86d9-aab42de84c34	2af4858e-2a77-4a7e-83ee-4256683516b4	Тестов Б.Б.	2026-07-09	\N	\N	2026-07-09 17:22:16.702056+00
91e754d5-c2ba-4673-b615-a0ce74c45f66	1487e473-bff7-463d-9a4c-9734aa29641b	Тестов В.В.	2026-07-09	\N	\N	2026-07-09 17:22:16.702056+00
36060a43-df0c-4a64-9849-937d629d1223	ff00b267-f546-4768-9d58-3bfe7d966357	Тестов Г.Г.	2026-07-09	\N	\N	2026-07-09 17:22:16.702056+00
9348f378-8212-4600-a9e3-9b32feaade71	be3c3703-4618-4250-99f5-443db991c2d9	Тестов Д.Д.	2026-07-09	\N	\N	2026-07-09 17:22:16.702056+00
8a2c9679-e4e4-40c2-bea0-ee7c240baa7c	2fc473f6-e7b2-4e09-8744-816d462acd97	Тестов Е.Е.	2026-07-09	\N	\N	2026-07-09 17:22:16.702056+00
267de4b9-ed7e-4fba-a8c3-5b26a1d50ba9	3d24c840-d4cf-48f9-a841-135859858832	Тестов Ж.Ж.	2026-07-09	\N	\N	2026-07-09 17:22:16.702056+00
e514e14b-5571-4828-91e1-a1db4d7a7224	aa97e0bf-7966-4ea3-967b-dfb66dff8235	Тестов З.З.	2026-07-09	\N	\N	2026-07-09 17:22:16.702056+00
4dd38015-ac85-40de-9448-7c1a632ad92c	90edb83d-c8aa-4f95-ab13-4a42e38a8e50	Тестов И.И.	2026-07-09	\N	\N	2026-07-09 17:22:16.702056+00
0b00f8a8-c3df-4ba0-a9b6-6f5a7f9294f2	9802befd-8fc2-435b-a1b8-b3dfec4aee98	Тестов К.К.	2026-07-09	\N	\N	2026-07-09 17:22:16.702056+00
dd0ac445-6359-4a3f-91fe-c71e8c6b83b4	5544c8d9-c752-4add-9b0b-2cbfa384aefc	Тестов Л.Л.	2026-07-09	\N	\N	2026-07-09 17:22:16.702056+00
d14ed1a9-f5f7-42b4-a777-24c0d37c7e53	d92a4f20-3def-4c00-a9be-bad4bce38a12	Тестов М.М.	2026-07-09	\N	\N	2026-07-09 17:22:16.702056+00
0ba30b8a-7e10-44d1-8588-3c483c945d20	8c07137a-79ba-4efa-a578-3073d9e05cf6	Титов Д.В.	2026-07-09	\N	Плановая доставка на сегодня	2026-07-09 09:44:27.530451+00
6012d935-cf27-4434-85c1-b0dccbdf85b0	35833539-33f8-4837-abee-b2c7a9a6b84f	Сидоров С.С.	2026-07-05	\N	\N	2026-07-09 09:08:15.69883+00
522668ce-9e00-467e-aadd-e8574bc454d1	27abfaed-0c0a-4962-ba9d-37a969d779a9	Белов А.П.	2026-07-06	\N	\N	2026-07-09 09:44:27.530451+00
b939a073-dfa0-4d22-a7b4-28d2effcba68	57292e3b-0267-4574-b45c-d6c1e4463ca6	Сидоров С.С.	2026-07-07	\N	\N	2026-07-09 09:44:27.530451+00
d37039db-c966-46ae-b3d5-52893d7e437c	af744b55-0e73-4268-8e3e-cfec4272cccd	Григорьев М.С.	2026-07-08	\N	\N	2026-07-09 09:44:27.530451+00
e5c3120b-1cf7-4f9b-b90e-0d9f47101413	cde5b212-96c7-4852-978f-7eb29a9db4b9	Морозов П.С.	2026-07-06	\N	\N	2026-07-09 09:44:27.530451+00
43e3a381-0e75-4420-b3c5-d197203dc222	128a3806-110f-4221-b18d-3230e5acbf13	Волков Д.Н.	2026-07-07	\N	\N	2026-07-09 09:44:27.530451+00
5e15eaa2-1e02-4549-a178-93158a5b3c27	7166c0c9-2182-4e6b-a482-0b03ddc841a1	Григорьев М.С.	2026-07-08	\N	\N	2026-07-09 09:44:27.530451+00
faa9ec23-4bdb-4a7b-bcca-0405cc4267e9	f3049241-8fa9-47f6-abf2-6f8ab02ab78c	Морозов П.С.	2026-07-06	\N	\N	2026-07-09 09:44:27.530451+00
9555f1fa-038d-4129-b8ab-d99d15a9c13e	c8fa3565-9350-445d-a60d-c05c4d02901e	Волков Д.Н.	2026-07-07	\N	\N	2026-07-09 09:44:27.530451+00
bcaeb2f2-233b-4b7f-848e-58694e5188a3	661f0848-d690-481c-a6ab-87c16cc691d6	Соколов А.И.	2026-07-08	\N	\N	2026-07-09 09:44:27.530451+00
76508707-90fb-4241-bd22-1f0ec27131bd	1a905e70-56c2-461d-9205-14391d2585dd	Титов Д.В.	2026-07-09	\N	Плановая доставка на сегодня	2026-07-09 09:44:27.530451+00
1f5a4f50-87cb-4df4-a926-9c07c13b68a1	ecaf7d04-3d5c-4c6c-924b-84442932ea5b	Лебедев Р.М.	2026-07-09	\N	Плановая доставка на сегодня	2026-07-09 09:44:27.530451+00
\.


--
-- Data for Name: goods_receipt_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.goods_receipt_items (id, receipt_id, product_id, quantity, price) FROM stdin;
75af6e6b-7f4e-40cd-8e2f-5eb0b6451e2d	915f8361-6f65-4371-a800-09b9d46fbbd7	d780385d-8fea-49b2-946c-3683b265eaae	10.00	100.00
5a8caf1c-813b-456c-904c-981e96193d1f	a6396656-3fe9-48b3-8b42-2babbc5ca3a8	a8c2ba7f-1304-4958-ac3e-5d955b106443	100.00	320.00
be991c71-ec1e-487d-9bba-d69edc5d11ad	a6396656-3fe9-48b3-8b42-2babbc5ca3a8	54d55478-7384-4c3f-93e7-392aa44da1f2	100.00	4500.00
548d6ea2-58fd-4d69-a006-92a409631fa0	f6be05ec-2dc9-4ddb-b199-64ed297f1dd7	50eceb2f-b0dd-4cf2-8d8d-f09ce593f464	3000.00	45.00
\.


--
-- Data for Name: goods_receipts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.goods_receipts (id, doc_number, doc_type, total_sum, note, created_at, is_posted) FROM stdin;
915f8361-6f65-4371-a800-09b9d46fbbd7	TEST-001	Накладная	1000.00	\N	2026-07-09 14:52:13.165708+00	t
a6396656-3fe9-48b3-8b42-2babbc5ca3a8	33	накладная	482000.00	\N	2026-07-09 16:11:47.049108+00	t
f6be05ec-2dc9-4ddb-b199-64ed297f1dd7	44	упд	135000.00	\N	2026-07-09 16:46:01.38234+00	f
\.


--
-- Data for Name: movements; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.movements (id, product_id, type, quantity, reason, note, created_at, shipment_id, goods_receipt_id) FROM stdin;
b50dd167-0171-4e02-acf2-1e6282716538	db15abf3-65a5-47d1-a683-15b46c2aecda	in	50.00	Поступление от поставщика	\N	2026-07-09 08:33:45.022083+00	\N	\N
1a0b0dbf-a1fa-4324-a9a5-58aebd909853	7b9dea13-c2a9-4ded-bd02-d4fddcdf6e4e	in	20.00	Поступление от поставщика	\N	2026-07-09 08:33:46.598409+00	\N	\N
8e687814-19ac-47cb-b329-772134bebd7c	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	in	15.00	Поступление от поставщика	\N	2026-07-09 08:33:48.184765+00	\N	\N
33514ba9-fe26-4236-ab58-82bf7877ca70	21a9ddd2-bb20-45b5-8f91-9d524df44f9d	in	200.00	Поступление от поставщика	\N	2026-07-09 08:33:49.695117+00	\N	\N
ad1cab59-c9b8-495c-8731-1365fcfb7ddf	50eceb2f-b0dd-4cf2-8d8d-f09ce593f464	in	80.00	Поступление от поставщика	\N	2026-07-09 08:33:51.791589+00	\N	\N
587972f5-91bf-4c1d-92a5-6effec984b84	a8c2ba7f-1304-4958-ac3e-5d955b106443	in	25.00	Поступление от поставщика	\N	2026-07-09 08:33:53.25493+00	\N	\N
dc09e981-448f-40f1-8038-e49e9a2107db	bf2f86a2-d85f-4910-8717-654c3e154f59	in	12.00	Поступление от поставщика	\N	2026-07-09 08:33:54.967179+00	\N	\N
bf9d4798-2153-4342-a054-8695b54ec12d	a92e9d1d-8fbf-4743-8e55-8c93336d9efb	in	40.00	Поступление от поставщика	\N	2026-07-09 08:33:56.316041+00	\N	\N
7f40850c-4670-4a1d-8325-e99655ad188d	db15abf3-65a5-47d1-a683-15b46c2aecda	out	35.00	Продажа	Заказ №1042	2026-07-09 08:33:57.950672+00	\N	\N
12b3f014-c670-4227-8722-c30a4cd4fcce	7b9dea13-c2a9-4ded-bd02-d4fddcdf6e4e	out	17.00	Продажа	Заказ №1043	2026-07-09 08:33:59.585646+00	\N	\N
b37184c8-36bf-4f6e-9f2e-5c2107fdbcee	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	8.00	Продажа	\N	2026-07-09 08:34:01.243507+00	\N	\N
1d53742d-dd2e-4b46-a378-a18af2ff3c90	21a9ddd2-bb20-45b5-8f91-9d524df44f9d	out	110.00	Продажа	\N	2026-07-09 08:34:02.797445+00	\N	\N
343a2a33-f703-49a7-8d1b-89e3e142c4ed	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	13.00	Продажа	\N	2026-07-09 08:34:04.472577+00	\N	\N
9f7ec358-532e-47ac-ba20-9aaddbc81d4f	bf2f86a2-d85f-4910-8717-654c3e154f59	out	5.00	Продажа	\N	2026-07-09 08:34:06.022461+00	\N	\N
13f9e6da-6e58-46d8-9fbd-6b072f89ffd1	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	10.00	Отгрузка по заказу №0f894676 (объект: Магазин на Ленина)	\N	2026-07-09 11:07:28.922064+00	\N	\N
c00aee89-acf7-42d2-8842-f124581f8226	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	8.00	Отгрузка по заказу №0f894676 (объект: Магазин на Ленина)	\N	2026-07-09 11:07:28.922064+00	\N	\N
294e4da8-77de-4b4b-918f-a16af6d859d8	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	10.00	Отгрузка по заказу №0f894676 (объект: Объект №1)	\N	2026-07-09 11:07:28.944615+00	\N	\N
0fa51d3b-4b82-45c0-99b9-d480cbceb5be	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	8.00	Отгрузка по заказу №0f894676 (объект: Объект №1)	\N	2026-07-09 11:07:28.944615+00	\N	\N
2cf51caa-1da7-4ce1-88da-e9a75963103c	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	10.00	Отгрузка по заказу №0f894676 (объект: Объект №10)	\N	2026-07-09 11:07:28.962447+00	\N	\N
4bc261ed-0325-45f3-8fc6-326fc93fd718	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	8.00	Отгрузка по заказу №0f894676 (объект: Объект №10)	\N	2026-07-09 11:07:28.962447+00	\N	\N
035ad309-1ba0-4b75-bab5-f2b3bd012870	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	10.00	Отгрузка по заказу №0f894676 (объект: Объект №11)	\N	2026-07-09 11:07:28.989508+00	\N	\N
0398995b-ace1-497a-9223-c7f25ad0a982	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	8.00	Отгрузка по заказу №0f894676 (объект: Объект №11)	\N	2026-07-09 11:07:28.989508+00	\N	\N
1fcfbe4b-5bd9-488d-bd92-8f754822074c	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	10.00	Отгрузка по заказу №0f894676 (объект: Объект №12)	\N	2026-07-09 11:07:29.002216+00	\N	\N
b4671fe6-fc83-49bf-bb6d-79ab03aeed3f	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	8.00	Отгрузка по заказу №0f894676 (объект: Объект №12)	\N	2026-07-09 11:07:29.002216+00	\N	\N
9888a79f-7bc1-403b-b6fe-9819cb37a881	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	10.00	Отгрузка по заказу №0f894676 (объект: Объект №13)	\N	2026-07-09 11:07:29.016839+00	\N	\N
f7c8c543-0189-4c69-991c-8940d41649a0	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	8.00	Отгрузка по заказу №0f894676 (объект: Объект №13)	\N	2026-07-09 11:07:29.016839+00	\N	\N
dbd13630-e40f-4555-873f-4877a16f73a6	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	10.00	Отгрузка по заказу №0f894676 (объект: Объект №14)	\N	2026-07-09 11:07:29.031649+00	\N	\N
c68a2517-695f-43e3-9d71-d06642436438	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	8.00	Отгрузка по заказу №0f894676 (объект: Объект №14)	\N	2026-07-09 11:07:29.031649+00	\N	\N
fec5d3fa-f3f8-48e8-9bec-c67f8c0007f3	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	10.00	Отгрузка по заказу №0f894676 (объект: Объект №15)	\N	2026-07-09 11:07:29.044168+00	\N	\N
e3cc4141-8600-4bb5-97d9-55ac86694378	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	8.00	Отгрузка по заказу №0f894676 (объект: Объект №15)	\N	2026-07-09 11:07:29.044168+00	\N	\N
d074139e-e8c0-4a5b-a0de-2f191e167adc	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	12.00	Отгрузка по заказу №ccc13d12 (объект: Объект №16)	\N	2026-07-09 11:07:29.057283+00	\N	\N
e6db1a57-7bc7-4a79-ae70-70115f643058	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	9.00	Отгрузка по заказу №ccc13d12 (объект: Объект №16)	\N	2026-07-09 11:07:29.057283+00	\N	\N
ef6d3cfb-1c55-41e9-a1b3-e674d79b0c9b	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	12.00	Отгрузка по заказу №ccc13d12 (объект: Объект №17)	\N	2026-07-09 11:07:29.068665+00	\N	\N
aaae3841-68b4-48e4-b613-0e9e95a5c828	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	9.00	Отгрузка по заказу №ccc13d12 (объект: Объект №17)	\N	2026-07-09 11:07:29.068665+00	\N	\N
4c199eb7-2e55-4881-bcc3-91998618bb6e	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	12.00	Отгрузка по заказу №ccc13d12 (объект: Объект №18)	\N	2026-07-09 11:07:29.081881+00	\N	\N
26755854-8222-4fb0-903f-b2afa996524e	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	9.00	Отгрузка по заказу №ccc13d12 (объект: Объект №18)	\N	2026-07-09 11:07:29.081881+00	\N	\N
e96ddd4f-edf3-4b14-9365-4b7190292354	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	12.00	Отгрузка по заказу №ccc13d12 (объект: Объект №19)	\N	2026-07-09 11:07:29.09318+00	\N	\N
666c3a08-6f79-4163-8278-0a7ceee468a5	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	9.00	Отгрузка по заказу №ccc13d12 (объект: Объект №19)	\N	2026-07-09 11:07:29.09318+00	\N	\N
d1b6099c-846c-4fd6-98d7-18005e147951	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	12.00	Отгрузка по заказу №ccc13d12 (объект: Объект №2)	\N	2026-07-09 11:07:29.104266+00	\N	\N
a81cf797-f8a8-4921-9cc4-64b0ed5b112f	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	9.00	Отгрузка по заказу №ccc13d12 (объект: Объект №2)	\N	2026-07-09 11:07:29.104266+00	\N	\N
7db819c6-efc3-4856-8ce6-1cd273f40a20	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	12.00	Отгрузка по заказу №ccc13d12 (объект: Объект №20)	\N	2026-07-09 11:07:29.11478+00	\N	\N
53bef79b-fbcf-449d-9e44-9c6705e34f0d	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	9.00	Отгрузка по заказу №ccc13d12 (объект: Объект №20)	\N	2026-07-09 11:07:29.11478+00	\N	\N
cf1c5e06-8e22-4674-8a25-3376dd564a7f	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	12.00	Отгрузка по заказу №ccc13d12 (объект: Объект №3)	\N	2026-07-09 11:07:29.125311+00	\N	\N
bab9a7d3-9ebe-46c3-b797-852d6fbc1a95	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	9.00	Отгрузка по заказу №ccc13d12 (объект: Объект №3)	\N	2026-07-09 11:07:29.125311+00	\N	\N
1f9e490a-a5ab-4470-8d18-398931c49e2b	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	12.00	Отгрузка по заказу №ccc13d12 (объект: Объект №3)	\N	2026-07-09 12:53:26.030054+00	4d21f259-4aab-4161-868f-bc74b1fda87c	\N
4437d690-6045-40a0-a9b9-e6c6e02fdd8b	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	9.00	Отгрузка по заказу №ccc13d12 (объект: Объект №3)	\N	2026-07-09 12:53:26.030054+00	4d21f259-4aab-4161-868f-bc74b1fda87c	\N
9c63e356-1f92-4586-8d2d-28a4fef368ed	ceb7c6cb-53d5-44e0-978a-bac4a4c1bd70	in	20.00	Поступление товара	\N	2026-07-09 13:34:17.617398+00	\N	\N
6418a529-20bc-479e-bd3c-0f5b67de343e	3d6bcf19-4015-4e62-8aca-1140c21fa083	in	20.00	Поступление товара	\N	2026-07-09 13:38:35.350165+00	\N	\N
5ed66495-50f6-4ee0-b883-31c76ccfa355	2e536475-52a5-4d9f-a458-029c445e8e23	in	5.00	Поступление товара	\N	2026-07-09 13:39:28.47216+00	\N	\N
28a1f73b-0a5f-42c4-8309-0ccb852b4f4f	eb1cdffe-f935-452b-a799-dfba9f4c3e75	out	3.00	Отгрузка по заказу №87fbf802 (объект: Объект №11)	\N	2026-07-09 14:42:26.897954+00	90af99c8-43bf-4aa9-b438-b800972df22c	\N
71ff2aed-5b15-4633-96ed-02724f154f49	d780385d-8fea-49b2-946c-3683b265eaae	in	10.00	Поступление по документу №TEST-001	\N	2026-07-09 14:52:13.165708+00	\N	915f8361-6f65-4371-a800-09b9d46fbbd7
28c4df74-5465-46dd-b21d-95f94b4fb75a	a8c2ba7f-1304-4958-ac3e-5d955b106443	in	100.00	Поступление по документу №33	\N	2026-07-09 16:11:47.049108+00	\N	a6396656-3fe9-48b3-8b42-2babbc5ca3a8
6ea9398d-2dbb-4dee-9140-d2205d3890f5	54d55478-7384-4c3f-93e7-392aa44da1f2	in	100.00	Поступление по документу №33	\N	2026-07-09 16:11:47.049108+00	\N	a6396656-3fe9-48b3-8b42-2babbc5ca3a8
cc42964c-8fde-4de9-b6cc-dfe1caa445da	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	100.00	Отгрузка по заказу №ccc13d12 (объект: Объект №18)	\N	2026-07-09 16:32:35.792635+00	f30dcb0d-1617-45f0-b5aa-2726d275e86d	\N
6b96c106-5300-488d-9207-323f764625db	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	37.00	Отгрузка по заказу №ccc13d12 (объект: Объект №18)	\N	2026-07-09 16:32:35.792635+00	f30dcb0d-1617-45f0-b5aa-2726d275e86d	\N
427667fe-c192-4b25-b791-c0270af886ca	50eceb2f-b0dd-4cf2-8d8d-f09ce593f464	in	3000.00	Поступление по документу №44	\N	2026-07-09 16:46:01.38234+00	\N	f6be05ec-2dc9-4ddb-b199-64ed297f1dd7
7a63ad52-4b6f-4c54-9fbd-d4023e2ead1a	a8c2ba7f-1304-4958-ac3e-5d955b106443	out	120.00	Отгрузка по заказу №0f894676 (объект: Объект №16)	\N	2026-07-09 16:46:36.410179+00	c3078df7-350d-4bde-8d54-a6f69c06bc82	\N
98b142c0-11b7-4139-91e7-c1e980162f6a	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	out	100.00	Отгрузка по заказу №0f894676 (объект: Объект №16)	\N	2026-07-09 16:46:36.410179+00	c3078df7-350d-4bde-8d54-a6f69c06bc82	\N
645cf73b-98e1-4192-89dc-0d1498a9ab9b	db15abf3-65a5-47d1-a683-15b46c2aecda	out	1.00	Отгрузка по заказу №0f894676 (объект: Объект №16)	\N	2026-07-09 16:46:36.410179+00	c3078df7-350d-4bde-8d54-a6f69c06bc82	\N
\.


--
-- Data for Name: order_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.order_items (id, order_id, product_id, quantity, price) FROM stdin;
e56abc4e-47ac-462d-9da6-c8b4e8ce9ca8	ccc13d12-6e9e-4367-9053-91d00ad5ad4e	a8c2ba7f-1304-4958-ac3e-5d955b106443	200.00	320.00
883cc31f-a74a-4f25-bf64-dcf63b08fdc8	ccc13d12-6e9e-4367-9053-91d00ad5ad4e	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	200.00	900.00
15941682-f255-4e62-9ac1-6927b0612b96	83f0a29e-2bd6-4a15-9876-97b9c82280ac	7b9dea13-c2a9-4ded-bd02-d4fddcdf6e4e	1.00	2500.00
860fa92a-7bdd-4d95-959b-bda290635556	83f0a29e-2bd6-4a15-9876-97b9c82280ac	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	1.04	900.00
c6f31a22-2a48-43ab-b5cd-01aaf84e816a	0f894676-e132-42fd-9f5d-a4f08ed45b25	a8c2ba7f-1304-4958-ac3e-5d955b106443	200.00	320.00
b5394009-4372-4a76-a975-09333c7c0b19	0f894676-e132-42fd-9f5d-a4f08ed45b25	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	200.00	900.00
b80decc5-1695-4b62-be57-70d335e7d4de	0f894676-e132-42fd-9f5d-a4f08ed45b25	db15abf3-65a5-47d1-a683-15b46c2aecda	1.00	250.00
e3190696-74d3-45a3-9272-b75224e5a9e9	87fbf802-d944-490d-adcb-ddd14a83a80a	eb1cdffe-f935-452b-a799-dfba9f4c3e75	3.00	100.00
d947ca87-8f19-4ae1-9fd8-856c13504076	39c351dc-4403-45c8-87d0-de0d760e74c1	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	1.00	900.00
97e0ec9c-3f0e-4564-b842-150f5d95398b	39c351dc-4403-45c8-87d0-de0d760e74c1	7b9dea13-c2a9-4ded-bd02-d4fddcdf6e4e	1.00	2500.00
66153e5b-3d3d-4b7d-b15a-d3561c17f5fc	39c351dc-4403-45c8-87d0-de0d760e74c1	21a9ddd2-bb20-45b5-8f91-9d524df44f9d	1.00	15.00
24aeefb6-9a5b-4366-a948-3a4a9549b8f0	39c351dc-4403-45c8-87d0-de0d760e74c1	a92e9d1d-8fbf-4743-8e55-8c93336d9efb	1.00	60.00
51b085f1-5ad7-4ec7-9d3c-91dc82f1a175	39c351dc-4403-45c8-87d0-de0d760e74c1	eb1cdffe-f935-452b-a799-dfba9f4c3e75	1.00	100.00
c2157252-70f6-41e1-ac6f-50a385a17de2	9bd0ae2b-0c2d-4290-8117-10c0d01826dc	3d6bcf19-4015-4e62-8aca-1140c21fa083	1.00	150.00
f98f5e26-2b12-492a-bb2d-218c8b323ace	56b518c8-f875-4b67-a86b-fb1580bf0db6	7b9dea13-c2a9-4ded-bd02-d4fddcdf6e4e	1.00	2500.00
2269efcc-ccf9-4d35-86f3-35e14afed508	7d1a6738-ac91-47f6-8ad9-00d9ba67570e	54d55478-7384-4c3f-93e7-392aa44da1f2	1.00	4500.00
395dbf48-6d38-469e-b4e4-a72959a08593	7d1a6738-ac91-47f6-8ad9-00d9ba67570e	ceb7c6cb-53d5-44e0-978a-bac4a4c1bd70	1.00	150.00
45377106-4201-4555-8e67-291e05c8bdc0	7d1a6738-ac91-47f6-8ad9-00d9ba67570e	a92e9d1d-8fbf-4743-8e55-8c93336d9efb	1.00	60.00
\.


--
-- Data for Name: order_payments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.order_payments (id, order_id, amount, note, created_at) FROM stdin;
5dc1366f-76f1-431e-93a3-8d3ac8301a95	39c351dc-4403-45c8-87d0-de0d760e74c1	3575.00	\N	2026-07-09 16:45:13.06369+00
\.


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.orders (id, client_id, is_paid, note, created_at) FROM stdin;
0f894676-e132-42fd-9f5d-a4f08ed45b25	251f1510-8be2-4dfc-82b9-5986c9d88e0d	t	Тестовый заказ №1 для проверки печати и множественных отгрузок	2026-07-09 11:07:28.895627+00
ccc13d12-6e9e-4367-9053-91d00ad5ad4e	b2ea4c50-06a3-456f-9999-ff1f60394391	t	Тестовый заказ №2 для проверки печати и множественных отгрузок	2026-07-09 11:07:28.91025+00
83f0a29e-2bd6-4a15-9876-97b9c82280ac	4159b63b-d56f-4406-8ccb-9e986c677dbb	f	\N	2026-07-09 12:40:53.175711+00
87fbf802-d944-490d-adcb-ddd14a83a80a	2bcb44f4-5320-4e3e-9934-db2f0d9f525a	t	\N	2026-07-09 13:44:08.212524+00
39c351dc-4403-45c8-87d0-de0d760e74c1	b2ea4c50-06a3-456f-9999-ff1f60394391	t	\N	2026-07-09 14:32:44.831797+00
9bd0ae2b-0c2d-4290-8117-10c0d01826dc	64209819-c1a3-467a-b365-018fc9c5c617	f	\N	2026-07-09 17:51:37.201557+00
56b518c8-f875-4b67-a86b-fb1580bf0db6	64209819-c1a3-467a-b365-018fc9c5c617	f	\N	2026-07-09 17:51:44.921417+00
7d1a6738-ac91-47f6-8ad9-00d9ba67570e	49dce057-28d1-4a9c-9bba-c233fca98484	f	\N	2026-07-09 17:51:59.953223+00
\.


--
-- Data for Name: products; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.products (id, name, sku, unit, price, category_id, min_stock, created_at, supplier, supplier_contact, purchase_price) FROM stdin;
db15abf3-65a5-47d1-a683-15b46c2aecda	Кабель USB-C 1м	EL-001	шт	250.00	8a1a1c68-4c46-422d-adaa-377e4d038bc7	20.00	2026-07-09 08:33:20.065062+00	\N	\N	0.00
7b9dea13-c2a9-4ded-bd02-d4fddcdf6e4e	Наушники беспроводные	EL-002	шт	2500.00	8a1a1c68-4c46-422d-adaa-377e4d038bc7	5.00	2026-07-09 08:33:21.566342+00	\N	\N	0.00
9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	Зарядное устройство 20W	EL-003	шт	900.00	8a1a1c68-4c46-422d-adaa-377e4d038bc7	10.00	2026-07-09 08:33:23.155808+00	\N	\N	0.00
21a9ddd2-bb20-45b5-8f91-9d524df44f9d	Ручка шариковая синяя	КА-001	шт	15.00	c72b1cd7-cf79-45eb-9872-d65d39e4d501	100.00	2026-07-09 08:33:24.64919+00	\N	\N	0.00
bf2f86a2-d85f-4910-8717-654c3e154f59	Средство для мытья полов	ХО-001	л	180.00	66dcf37e-bc14-4482-afcf-d0828501b08f	10.00	2026-07-09 08:33:30.656017+00	\N	\N	0.00
a92e9d1d-8fbf-4743-8e55-8c93336d9efb	Перчатки хозяйственные	ХО-002	пар	60.00	66dcf37e-bc14-4482-afcf-d0828501b08f	30.00	2026-07-09 08:33:32.455755+00	\N	\N	0.00
ceb7c6cb-53d5-44e0-978a-bac4a4c1bd70	Тестовый товар QVB6	Тестовый товар QVB6	шт	150.00	\N	0.00	2026-07-09 13:34:17.33616+00	\N	\N	0.00
3d6bcf19-4015-4e62-8aca-1140c21fa083	Тестовый товар 3BFr	Тестовый товар 3BFr	шт	150.00	\N	0.00	2026-07-09 13:38:35.31395+00	\N	\N	0.00
2e536475-52a5-4d9f-a458-029c445e8e23	Тестовый товар 3BFr	Тестовый товар 3BFr-2	шт	200.00	\N	0.00	2026-07-09 13:39:28.466751+00	\N	\N	0.00
eb1cdffe-f935-452b-a799-dfba9f4c3e75	Товар для заказа j8L-	SKU-Wd02bs	шт	100.00	\N	0.00	2026-07-09 13:44:08.208749+00	\N	\N	50.00
d780385d-8fea-49b2-946c-3683b265eaae	Тестовый товар	Тестовый товар	шт	100.00	\N	0.00	2026-07-09 14:52:13.165708+00	\N	\N	0.00
a8c2ba7f-1304-4958-ac3e-5d955b106443	Бумага А4 (пачка)	КА-003	уп	320.00	c72b1cd7-cf79-45eb-9872-d65d39e4d501	15.00	2026-07-09 08:33:29.236752+00	\N	\N	100.00
54d55478-7384-4c3f-93e7-392aa44da1f2	РОМАШЕНЦИЯ	РОМАШЕНЦИЯ	шт	4500.00	6fb0406d-f462-49e6-aec7-ae611c545884	50.00	2026-07-09 16:11:47.049108+00	ИП Ромашков	\N	3000.00
50eceb2f-b0dd-4cf2-8d8d-f09ce593f464	Тетрадь 48 листов	КА-002	шт	45.00	c72b1cd7-cf79-45eb-9872-d65d39e4d501	50.00	2026-07-09 08:33:27.463616+00	ку ку	\N	50.00
\.


--
-- Data for Name: shipment_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.shipment_items (id, shipment_id, product_id, quantity) FROM stdin;
e7ff99ad-b8c3-4eaf-ae87-4dd17d6d5959	aa825761-ca9d-4212-8c18-efd1bda475b1	a8c2ba7f-1304-4958-ac3e-5d955b106443	10.00
b19a1f89-45d2-440e-9c59-b95e4037a513	aa825761-ca9d-4212-8c18-efd1bda475b1	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	8.00
5cdb9e63-ee61-4b12-b3f0-af061b99c0f2	72a6641d-55b0-4f95-8466-b557e5cf5c7a	a8c2ba7f-1304-4958-ac3e-5d955b106443	10.00
86cbb297-005a-4dc2-a40f-c0f40722b3ad	72a6641d-55b0-4f95-8466-b557e5cf5c7a	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	8.00
8cebea55-c2c3-45eb-9f1e-de5aca7da40c	c9fafd56-9b1d-4f36-8b06-07c799e339c5	a8c2ba7f-1304-4958-ac3e-5d955b106443	10.00
09e9c234-7179-4dc9-ad3f-f78cedb77d8b	c9fafd56-9b1d-4f36-8b06-07c799e339c5	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	8.00
6c657bef-353f-4736-8c1b-0bf93a41fb2f	73563f48-e707-4920-9c12-4cf5046367a3	a8c2ba7f-1304-4958-ac3e-5d955b106443	10.00
9d663b37-55a7-4993-909f-29d968bdea06	73563f48-e707-4920-9c12-4cf5046367a3	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	8.00
e166dfaa-e06a-46f8-bcb5-b6f9c78da613	96ae6cc4-74e9-4118-a0f5-bc7d8d68353c	a8c2ba7f-1304-4958-ac3e-5d955b106443	10.00
3acafc78-b54c-44f6-a34f-0f08cf011a06	96ae6cc4-74e9-4118-a0f5-bc7d8d68353c	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	8.00
7bab671c-cab1-42c1-af21-0e9dc9c77972	3dfe846c-51b6-4285-87c0-71e8506a4df8	a8c2ba7f-1304-4958-ac3e-5d955b106443	10.00
6cc03905-ec30-4f5b-9054-1396950d9b2b	3dfe846c-51b6-4285-87c0-71e8506a4df8	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	8.00
10f34ace-469a-45cd-b692-bfc93ffcb16e	66d4c25a-8d15-4c3b-82ee-851fda6ebc97	a8c2ba7f-1304-4958-ac3e-5d955b106443	10.00
832c6e4f-5d25-4563-8f3a-02ef0e99a946	66d4c25a-8d15-4c3b-82ee-851fda6ebc97	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	8.00
27cf0212-aeed-4815-b2a5-9bb704221947	73474bc8-6db1-42a6-ba6f-d16aaaa4a5fa	a8c2ba7f-1304-4958-ac3e-5d955b106443	10.00
67175f62-3bd2-4556-8f5d-9b47dc96622c	73474bc8-6db1-42a6-ba6f-d16aaaa4a5fa	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	8.00
f46c735d-2a3f-4c29-a81c-b68741689bd8	b17fcdc0-372b-447d-a888-6037eb4b0b06	a8c2ba7f-1304-4958-ac3e-5d955b106443	12.00
927c05c2-f86f-4164-a3e6-32b28b6564c0	b17fcdc0-372b-447d-a888-6037eb4b0b06	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	9.00
ea9752bc-b0f8-46da-8ad7-e87ecab20d43	bbf4d92a-29ce-43f0-84fb-4f462ec8058e	a8c2ba7f-1304-4958-ac3e-5d955b106443	12.00
1bde9d28-47ca-473a-995a-ac8176fd3775	bbf4d92a-29ce-43f0-84fb-4f462ec8058e	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	9.00
aa546219-d9c8-46ea-bd0e-21940c3c7f20	9af1a716-1e52-48fa-9d08-37e5f6f07135	a8c2ba7f-1304-4958-ac3e-5d955b106443	12.00
2770b24b-c75e-4a2f-a17e-8d7fad96d0f2	9af1a716-1e52-48fa-9d08-37e5f6f07135	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	9.00
74c4e12d-fb0e-43c9-93b0-736d713871c2	f67ddd2d-ecc9-4630-ba88-8ca3828771ec	a8c2ba7f-1304-4958-ac3e-5d955b106443	12.00
91278e80-4b7d-40a8-8129-c6929f1ba456	f67ddd2d-ecc9-4630-ba88-8ca3828771ec	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	9.00
b396f31e-3e06-413d-ad03-70efb1a009bf	66ffbd39-efac-410f-aab7-b88c99c88b58	a8c2ba7f-1304-4958-ac3e-5d955b106443	12.00
95d1cca8-1534-4f15-b23f-7114d9fcc66a	66ffbd39-efac-410f-aab7-b88c99c88b58	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	9.00
3a0e72cf-7ad2-4885-818d-7fab1014da4b	31767af2-8209-476c-869b-da45697b2d34	a8c2ba7f-1304-4958-ac3e-5d955b106443	12.00
f4c8e882-7808-4d7e-b366-6e1ecd7af349	31767af2-8209-476c-869b-da45697b2d34	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	9.00
9baa93af-efe2-4049-a0d2-79e90a69d0a8	4d21f259-4aab-4161-868f-bc74b1fda87c	a8c2ba7f-1304-4958-ac3e-5d955b106443	12.00
a8a785cd-09b1-44f0-be45-7f4462485c1d	4d21f259-4aab-4161-868f-bc74b1fda87c	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	9.00
54a32001-1e9b-4d2d-bf8f-38b2697efb16	90af99c8-43bf-4aa9-b438-b800972df22c	eb1cdffe-f935-452b-a799-dfba9f4c3e75	3.00
327a629a-221d-443a-8e09-31bb442a5f7e	f30dcb0d-1617-45f0-b5aa-2726d275e86d	a8c2ba7f-1304-4958-ac3e-5d955b106443	100.00
97d9fcdc-6d36-48d3-b880-c52d0c8e4119	f30dcb0d-1617-45f0-b5aa-2726d275e86d	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	37.00
293298c4-a14f-4f01-83b4-7bc12258e7ea	c3078df7-350d-4bde-8d54-a6f69c06bc82	a8c2ba7f-1304-4958-ac3e-5d955b106443	120.00
3fb8a3fe-05c9-4dd1-9e04-cef063e275dd	c3078df7-350d-4bde-8d54-a6f69c06bc82	9c7c0402-ba9c-4ea5-a473-5f0fcf56cba3	100.00
a28840c2-6870-4385-85e2-442564645caa	c3078df7-350d-4bde-8d54-a6f69c06bc82	db15abf3-65a5-47d1-a683-15b46c2aecda	1.00
\.


--
-- Data for Name: shipments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.shipments (id, order_id, site_id, driver, shipment_date, note, created_at, is_dispatched, dispatched_at, is_deleted, deleted_at, delete_note) FROM stdin;
73563f48-e707-4920-9c12-4cf5046367a3	0f894676-e132-42fd-9f5d-a4f08ed45b25	1a905e70-56c2-461d-9205-14391d2585dd	Титов Д.В.	2026-07-04	\N	2026-07-09 11:07:28.989508+00	f	\N	f	\N	\N
73474bc8-6db1-42a6-ba6f-d16aaaa4a5fa	0f894676-e132-42fd-9f5d-a4f08ed45b25	f3049241-8fa9-47f6-abf2-6f8ab02ab78c	Морозов П.С.	2026-07-08	\N	2026-07-09 11:07:29.044168+00	f	\N	f	\N	\N
b17fcdc0-372b-447d-a888-6037eb4b0b06	ccc13d12-6e9e-4367-9053-91d00ad5ad4e	c8fa3565-9350-445d-a60d-c05c4d02901e	Волков Д.Н.	2026-07-01	\N	2026-07-09 11:07:29.057283+00	f	\N	f	\N	\N
bbf4d92a-29ce-43f0-84fb-4f462ec8058e	ccc13d12-6e9e-4367-9053-91d00ad5ad4e	661f0848-d690-481c-a6ab-87c16cc691d6	Соколов А.И.	2026-07-02	\N	2026-07-09 11:07:29.068665+00	f	\N	f	\N	\N
9af1a716-1e52-48fa-9d08-37e5f6f07135	ccc13d12-6e9e-4367-9053-91d00ad5ad4e	ecaf7d04-3d5c-4c6c-924b-84442932ea5b	Лебедев Р.М.	2026-07-03	\N	2026-07-09 11:07:29.081881+00	f	\N	f	\N	\N
f67ddd2d-ecc9-4630-ba88-8ca3828771ec	ccc13d12-6e9e-4367-9053-91d00ad5ad4e	87a12aa4-eb87-4b7f-8527-576ba8f18dd4	Новиков Е.В.	2026-07-04	\N	2026-07-09 11:07:29.09318+00	f	\N	f	\N	\N
66ffbd39-efac-410f-aab7-b88c99c88b58	ccc13d12-6e9e-4367-9053-91d00ad5ad4e	57292e3b-0267-4574-b45c-d6c1e4463ca6	Сидоров С.С.	2026-07-05	\N	2026-07-09 11:07:29.104266+00	f	\N	f	\N	\N
31767af2-8209-476c-869b-da45697b2d34	ccc13d12-6e9e-4367-9053-91d00ad5ad4e	83550092-db80-49bf-9cb5-8a44487b5abf	Белов А.П.	2026-07-06	\N	2026-07-09 11:07:29.11478+00	f	\N	f	\N	\N
72a6641d-55b0-4f95-8466-b557e5cf5c7a	0f894676-e132-42fd-9f5d-a4f08ed45b25	27abfaed-0c0a-4962-ba9d-37a969d779a9	Белов А.П.	2026-07-02	аптека	2026-07-09 11:07:28.944615+00	f	\N	f	\N	\N
c9fafd56-9b1d-4f36-8b06-07c799e339c5	0f894676-e132-42fd-9f5d-a4f08ed45b25	7166c0c9-2182-4e6b-a482-0b03ddc841a1	Григорьев М.С.	2026-07-03	магнит	2026-07-09 11:07:28.962447+00	f	\N	f	\N	\N
4d21f259-4aab-4161-868f-bc74b1fda87c	ccc13d12-6e9e-4367-9053-91d00ad5ad4e	af744b55-0e73-4268-8e3e-cfec4272cccd	Григорьев М.С.	2026-07-07	\N	2026-07-09 11:07:29.125311+00	f	\N	f	\N	\N
aa825761-ca9d-4212-8c18-efd1bda475b1	0f894676-e132-42fd-9f5d-a4f08ed45b25	35833539-33f8-4837-abee-b2c7a9a6b84f	Сидоров С.С.	2026-07-01	дикси	2026-07-09 11:07:28.922064+00	t	2026-07-09 14:51:26.19+00	f	\N	\N
90af99c8-43bf-4aa9-b438-b800972df22c	87fbf802-d944-490d-adcb-ddd14a83a80a	1a905e70-56c2-461d-9205-14391d2585dd	Титов Д.В.	2026-07-09	\N	2026-07-09 14:42:26.897954+00	t	2026-07-09 15:46:42.345+00	f	\N	\N
3dfe846c-51b6-4285-87c0-71e8506a4df8	0f894676-e132-42fd-9f5d-a4f08ed45b25	e69276e4-4752-426a-8155-e02dcfbd9f08	Кузнецов И.О.	2026-07-06	\N	2026-07-09 11:07:29.016839+00	t	2026-07-09 16:09:48.389+00	f	\N	\N
66d4c25a-8d15-4c3b-82ee-851fda6ebc97	0f894676-e132-42fd-9f5d-a4f08ed45b25	b694c984-aa87-430c-b5f7-071e881fd81b	Смирнов В.А.	2026-07-07	\N	2026-07-09 11:07:29.031649+00	t	2026-07-09 16:09:55.834+00	f	\N	\N
96ae6cc4-74e9-4118-a0f5-bc7d8d68353c	0f894676-e132-42fd-9f5d-a4f08ed45b25	b20815bc-37cc-4bbf-b39d-0168c5c52586	Захаров К.Н.	2026-07-05	\N	2026-07-09 11:07:29.002216+00	t	2026-07-09 16:12:15.922+00	f	\N	\N
f30dcb0d-1617-45f0-b5aa-2726d275e86d	ccc13d12-6e9e-4367-9053-91d00ad5ad4e	ecaf7d04-3d5c-4c6c-924b-84442932ea5b	Лебедев Р.М.	2026-07-09	\N	2026-07-09 16:32:35.792635+00	f	\N	f	\N	\N
c3078df7-350d-4bde-8d54-a6f69c06bc82	0f894676-e132-42fd-9f5d-a4f08ed45b25	c8fa3565-9350-445d-a60d-c05c4d02901e	Волков Д.Н.	2026-07-13	\N	2026-07-09 16:46:36.410179+00	t	2026-07-09 16:46:47.216+00	f	\N	\N
\.


--
-- Data for Name: sites; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sites (id, name, address, branch, client, manager, director, project, driver, store_area, created_at, customer) FROM stdin;
35833539-33f8-4837-abee-b2c7a9a6b84f	Магазин на Ленина	г. Москва, ул. Ленина, 10	Центральный	ООО Ромашка	Иванов И.И.	Петров П.П.	Розница-2026	Сидоров С.С.	250.00	2026-07-09 08:45:22.812724+00	
27abfaed-0c0a-4962-ba9d-37a969d779a9	Объект №1	г. Санкт-Петербург, ул. Советская, 1	Северный	ЗАО Стройсервис	Петрова А.С.	Волков С.И.	Опт-Восток	Белов А.П.	63.00	2026-07-09 09:44:18.973519+00	
57292e3b-0267-4574-b45c-d6c1e4463ca6	Объект №2	г. Казань, ул. Заводская, 2	Южный	ООО Технопарк	Сидоров В.В.	Никитина О.В.	Склад-Юг	Сидоров С.С.	76.00	2026-07-09 09:44:19.008762+00	
af744b55-0e73-4268-8e3e-cfec4272cccd	Объект №3	г. Новосибирск, пр. Мира, 3	Восточный	ООО Прогресс	Кузнецова Е.Н.	Ковалёв Р.М.	Логистика-Центр	Григорьев М.С.	89.00	2026-07-09 09:44:19.014346+00	
8c07137a-79ba-4efa-a578-3073d9e05cf6	Объект №4	г. Екатеринбург, ул. Победы, 4	Западный	ООО Ромашка	Морозов Д.А.	Петров П.П.	Экспансия-2026	Титов Д.В.	102.00	2026-07-09 09:44:19.017746+00	
5e8f8138-8c02-433e-bf70-4f167fbaa8e2	Объект №5	г. Москва, ул. Комсомольская, 5	Центральный	ЗАО Стройсервис	Иванов И.И.	Волков С.И.	Розница-2026	Захаров К.Н.	115.00	2026-07-09 09:44:19.021485+00	
8d604b0a-0df9-4f4b-b6be-24e5b3168954	Объект №6	г. Санкт-Петербург, ул. Гагарина, 6	Северный	ООО Технопарк	Петрова А.С.	Никитина О.В.	Опт-Восток	Кузнецов И.О.	128.00	2026-07-09 09:44:19.024888+00	
9d2420fa-05e1-4ea9-a753-f50180c62e01	Объект №7	г. Казань, пр. Строителей, 7	Южный	ООО Прогресс	Сидоров В.В.	Ковалёв Р.М.	Склад-Юг	Смирнов В.А.	141.00	2026-07-09 09:44:19.028057+00	
cde5b212-96c7-4852-978f-7eb29a9db4b9	Объект №8	г. Новосибирск, ул. Ленина, 8	Восточный	ООО Ромашка	Кузнецова Е.Н.	Петров П.П.	Логистика-Центр	Морозов П.С.	154.00	2026-07-09 09:44:19.032486+00	
128a3806-110f-4221-b18d-3230e5acbf13	Объект №9	г. Екатеринбург, ул. Советская, 9	Западный	ЗАО Стройсервис	Морозов Д.А.	Волков С.И.	Экспансия-2026	Волков Д.Н.	167.00	2026-07-09 09:44:19.036138+00	
7166c0c9-2182-4e6b-a482-0b03ddc841a1	Объект №10	г. Москва, ул. Заводская, 10	Центральный	ООО Технопарк	Иванов И.И.	Никитина О.В.	Розница-2026	Григорьев М.С.	180.00	2026-07-09 09:44:19.039904+00	
1a905e70-56c2-461d-9205-14391d2585dd	Объект №11	г. Санкт-Петербург, пр. Мира, 11	Северный	ООО Прогресс	Петрова А.С.	Ковалёв Р.М.	Опт-Восток	Титов Д.В.	193.00	2026-07-09 09:44:19.04324+00	
b20815bc-37cc-4bbf-b39d-0168c5c52586	Объект №12	г. Казань, ул. Победы, 12	Южный	ООО Ромашка	Сидоров В.В.	Петров П.П.	Склад-Юг	Захаров К.Н.	206.00	2026-07-09 09:44:19.046698+00	
e69276e4-4752-426a-8155-e02dcfbd9f08	Объект №13	г. Новосибирск, ул. Комсомольская, 13	Восточный	ЗАО Стройсервис	Кузнецова Е.Н.	Волков С.И.	Логистика-Центр	Кузнецов И.О.	219.00	2026-07-09 09:44:19.050003+00	
b694c984-aa87-430c-b5f7-071e881fd81b	Объект №14	г. Екатеринбург, ул. Гагарина, 14	Западный	ООО Технопарк	Морозов Д.А.	Никитина О.В.	Экспансия-2026	Смирнов В.А.	232.00	2026-07-09 09:44:19.052663+00	
f3049241-8fa9-47f6-abf2-6f8ab02ab78c	Объект №15	г. Москва, пр. Строителей, 15	Центральный	ООО Прогресс	Иванов И.И.	Ковалёв Р.М.	Розница-2026	Морозов П.С.	245.00	2026-07-09 09:44:19.058107+00	
c8fa3565-9350-445d-a60d-c05c4d02901e	Объект №16	г. Санкт-Петербург, ул. Ленина, 16	Северный	ООО Ромашка	Петрова А.С.	Петров П.П.	Опт-Восток	Волков Д.Н.	258.00	2026-07-09 09:44:19.06214+00	
661f0848-d690-481c-a6ab-87c16cc691d6	Объект №17	г. Казань, ул. Советская, 17	Южный	ЗАО Стройсервис	Сидоров В.В.	Волков С.И.	Склад-Юг	Соколов А.И.	271.00	2026-07-09 09:44:19.065581+00	
ecaf7d04-3d5c-4c6c-924b-84442932ea5b	Объект №18	г. Новосибирск, ул. Заводская, 18	Восточный	ООО Технопарк	Кузнецова Е.Н.	Никитина О.В.	Логистика-Центр	Лебедев Р.М.	284.00	2026-07-09 09:44:19.068493+00	
87a12aa4-eb87-4b7f-8527-576ba8f18dd4	Объект №19	г. Екатеринбург, пр. Мира, 19	Западный	ООО Прогресс	Морозов Д.А.	Ковалёв Р.М.	Экспансия-2026	Новиков Е.В.	297.00	2026-07-09 09:44:19.072593+00	
83550092-db80-49bf-9cb5-8a44487b5abf	Объект №20	г. Москва, ул. Победы, 20	Центральный	ООО Ромашка	Иванов И.И.	Петров П.П.	Розница-2026	Белов А.П.	310.00	2026-07-09 09:44:19.076202+00	
8300e1ec-58bf-4946-9efb-90bb415e7228	Тест-объект №101	г. Тест, ул. Нагрузочная, д. 1	Тестовый филиал	Тест-клиент нагрузки	Менеджер Т.	Директор Т.	Нагрузочный тест	Тестов А.А.	100.00	2026-07-09 17:22:16.702056+00	
2af4858e-2a77-4a7e-83ee-4256683516b4	Тест-объект №102	г. Тест, ул. Нагрузочная, д. 2	Тестовый филиал	Тест-клиент нагрузки	Менеджер Т.	Директор Т.	Нагрузочный тест	Тестов Б.Б.	100.00	2026-07-09 17:22:16.702056+00	
1487e473-bff7-463d-9a4c-9734aa29641b	Тест-объект №103	г. Тест, ул. Нагрузочная, д. 3	Тестовый филиал	Тест-клиент нагрузки	Менеджер Т.	Директор Т.	Нагрузочный тест	Тестов В.В.	100.00	2026-07-09 17:22:16.702056+00	
ff00b267-f546-4768-9d58-3bfe7d966357	Тест-объект №104	г. Тест, ул. Нагрузочная, д. 4	Тестовый филиал	Тест-клиент нагрузки	Менеджер Т.	Директор Т.	Нагрузочный тест	Тестов Г.Г.	100.00	2026-07-09 17:22:16.702056+00	
be3c3703-4618-4250-99f5-443db991c2d9	Тест-объект №105	г. Тест, ул. Нагрузочная, д. 5	Тестовый филиал	Тест-клиент нагрузки	Менеджер Т.	Директор Т.	Нагрузочный тест	Тестов Д.Д.	100.00	2026-07-09 17:22:16.702056+00	
2fc473f6-e7b2-4e09-8744-816d462acd97	Тест-объект №106	г. Тест, ул. Нагрузочная, д. 6	Тестовый филиал	Тест-клиент нагрузки	Менеджер Т.	Директор Т.	Нагрузочный тест	Тестов Е.Е.	100.00	2026-07-09 17:22:16.702056+00	
3d24c840-d4cf-48f9-a841-135859858832	Тест-объект №107	г. Тест, ул. Нагрузочная, д. 7	Тестовый филиал	Тест-клиент нагрузки	Менеджер Т.	Директор Т.	Нагрузочный тест	Тестов Ж.Ж.	100.00	2026-07-09 17:22:16.702056+00	
aa97e0bf-7966-4ea3-967b-dfb66dff8235	Тест-объект №108	г. Тест, ул. Нагрузочная, д. 8	Тестовый филиал	Тест-клиент нагрузки	Менеджер Т.	Директор Т.	Нагрузочный тест	Тестов З.З.	100.00	2026-07-09 17:22:16.702056+00	
90edb83d-c8aa-4f95-ab13-4a42e38a8e50	Тест-объект №109	г. Тест, ул. Нагрузочная, д. 9	Тестовый филиал	Тест-клиент нагрузки	Менеджер Т.	Директор Т.	Нагрузочный тест	Тестов И.И.	100.00	2026-07-09 17:22:16.702056+00	
9802befd-8fc2-435b-a1b8-b3dfec4aee98	Тест-объект №110	г. Тест, ул. Нагрузочная, д. 10	Тестовый филиал	Тест-клиент нагрузки	Менеджер Т.	Директор Т.	Нагрузочный тест	Тестов К.К.	100.00	2026-07-09 17:22:16.702056+00	
5544c8d9-c752-4add-9b0b-2cbfa384aefc	Тест-объект №111	г. Тест, ул. Нагрузочная, д. 11	Тестовый филиал	Тест-клиент нагрузки	Менеджер Т.	Директор Т.	Нагрузочный тест	Тестов Л.Л.	100.00	2026-07-09 17:22:16.702056+00	
d92a4f20-3def-4c00-a9be-bad4bce38a12	Тест-объект №112	г. Тест, ул. Нагрузочная, д. 12	Тестовый филиал	Тест-клиент нагрузки	Менеджер Т.	Директор Т.	Нагрузочный тест	Тестов М.М.	100.00	2026-07-09 17:22:16.702056+00	
\.


--
-- Name: app_users app_users_clerk_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_clerk_user_id_unique UNIQUE (clerk_user_id);


--
-- Name: app_users app_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: deliveries deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_pkey PRIMARY KEY (id);


--
-- Name: goods_receipt_items goods_receipt_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goods_receipt_items
    ADD CONSTRAINT goods_receipt_items_pkey PRIMARY KEY (id);


--
-- Name: goods_receipts goods_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_pkey PRIMARY KEY (id);


--
-- Name: movements movements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movements
    ADD CONSTRAINT movements_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_payments order_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: shipment_items shipment_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shipment_items
    ADD CONSTRAINT shipment_items_pkey PRIMARY KEY (id);


--
-- Name: shipments shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);


--
-- Name: sites sites_name_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_name_unique UNIQUE (name);


--
-- Name: sites sites_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_pkey PRIMARY KEY (id);


--
-- Name: app_users_clerk_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX app_users_clerk_user_id_idx ON public.app_users USING btree (clerk_user_id);


--
-- Name: goods_receipt_items_product_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX goods_receipt_items_product_id_idx ON public.goods_receipt_items USING btree (product_id);


--
-- Name: goods_receipt_items_receipt_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX goods_receipt_items_receipt_id_idx ON public.goods_receipt_items USING btree (receipt_id);


--
-- Name: goods_receipts_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX goods_receipts_created_at_idx ON public.goods_receipts USING btree (created_at);


--
-- Name: movements_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX movements_created_at_idx ON public.movements USING btree (created_at);


--
-- Name: movements_goods_receipt_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX movements_goods_receipt_id_idx ON public.movements USING btree (goods_receipt_id);


--
-- Name: movements_product_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX movements_product_id_idx ON public.movements USING btree (product_id);


--
-- Name: movements_shipment_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX movements_shipment_id_idx ON public.movements USING btree (shipment_id);


--
-- Name: movements_type_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX movements_type_idx ON public.movements USING btree (type);


--
-- Name: order_payments_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX order_payments_created_at_idx ON public.order_payments USING btree (created_at);


--
-- Name: order_payments_order_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX order_payments_order_id_idx ON public.order_payments USING btree (order_id);


--
-- Name: orders_client_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX orders_client_id_idx ON public.orders USING btree (client_id);


--
-- Name: orders_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX orders_created_at_idx ON public.orders USING btree (created_at);


--
-- Name: orders_is_paid_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX orders_is_paid_idx ON public.orders USING btree (is_paid);


--
-- Name: shipments_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX shipments_created_at_idx ON public.shipments USING btree (created_at);


--
-- Name: shipments_order_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX shipments_order_id_idx ON public.shipments USING btree (order_id);


--
-- Name: shipments_shipment_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX shipments_shipment_date_idx ON public.shipments USING btree (shipment_date);


--
-- Name: shipments_site_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX shipments_site_id_idx ON public.shipments USING btree (site_id);


--
-- Name: sites_client_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sites_client_idx ON public.sites USING btree (client);


--
-- Name: sites_driver_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sites_driver_idx ON public.sites USING btree (driver);


--
-- Name: deliveries deliveries_site_id_sites_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_site_id_sites_id_fk FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;


--
-- Name: goods_receipt_items goods_receipt_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goods_receipt_items
    ADD CONSTRAINT goods_receipt_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: goods_receipt_items goods_receipt_items_receipt_id_goods_receipts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goods_receipt_items
    ADD CONSTRAINT goods_receipt_items_receipt_id_goods_receipts_id_fk FOREIGN KEY (receipt_id) REFERENCES public.goods_receipts(id) ON DELETE CASCADE;


--
-- Name: movements movements_goods_receipt_id_goods_receipts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movements
    ADD CONSTRAINT movements_goods_receipt_id_goods_receipts_id_fk FOREIGN KEY (goods_receipt_id) REFERENCES public.goods_receipts(id) ON DELETE CASCADE;


--
-- Name: movements movements_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movements
    ADD CONSTRAINT movements_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: movements movements_shipment_id_shipments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movements
    ADD CONSTRAINT movements_shipment_id_shipments_id_fk FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: order_payments order_payments_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: orders orders_client_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: products products_category_id_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: shipment_items shipment_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shipment_items
    ADD CONSTRAINT shipment_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: shipment_items shipment_items_shipment_id_shipments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shipment_items
    ADD CONSTRAINT shipment_items_shipment_id_shipments_id_fk FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;


--
-- Name: shipments shipments_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: shipments shipments_site_id_sites_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_site_id_sites_id_fk FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict UZEiWyrR22Ca3snfTbGHc9lLpNS1HyCkXJzR6OyNLNK7r5ksufJ3kROn3ucLiUY

