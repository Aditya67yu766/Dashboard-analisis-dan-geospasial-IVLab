create extension if not exists pgcrypto;

create table if not exists public.iv_lab_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.iv_lab_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  data_year integer not null,
  record_count integer not null default 0,
  skipped_province_count integer not null default 0,
  status text not null default 'processing',
  imported_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.iv_lab_records (
  id uuid primary key default gen_random_uuid(),
  registration_date date not null,
  kode_sampel text not null,
  nama_uji text not null,
  metode_uji text not null,
  interpretasi_hasil text not null,
  provinsi text not null,
  kabupaten text,
  kecamatan text,
  no_registrasi text,
  sample_analysis_number text,
  hewan text,
  jenis_layanan text,
  import_id uuid references public.iv_lab_imports (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.iv_lab_records
  add column if not exists import_id uuid references public.iv_lab_imports (id) on delete cascade;

alter table public.iv_lab_records
  alter column interpretasi_hasil drop not null;

create index if not exists iv_lab_records_date_idx
  on public.iv_lab_records (registration_date);
create index if not exists iv_lab_records_import_id_idx
  on public.iv_lab_records (import_id);
create index if not exists iv_lab_records_provinsi_idx
  on public.iv_lab_records (provinsi);
create index if not exists iv_lab_records_created_at_idx
  on public.iv_lab_records (created_at desc);
create unique index if not exists iv_lab_imports_legacy_year_idx
  on public.iv_lab_imports (data_year) where status = 'legacy';

-- Indeks komposit untuk mempercepat agregasi dashboard data (chart & map)
create index if not exists iv_lab_records_chart_agg_idx
  on public.iv_lab_records (provinsi, nama_uji, metode_uji, interpretasi_hasil, registration_date);
create index if not exists iv_lab_records_map_agg_idx
  on public.iv_lab_records (provinsi, kabupaten, kecamatan, nama_uji, interpretasi_hasil, registration_date);
create index if not exists iv_lab_records_kabupaten_idx
  on public.iv_lab_records (kabupaten);
create index if not exists iv_lab_records_kecamatan_idx
  on public.iv_lab_records (kecamatan);
create index if not exists iv_lab_records_nama_uji_idx
  on public.iv_lab_records (nama_uji);
create index if not exists iv_lab_records_metode_uji_idx
  on public.iv_lab_records (metode_uji);
create index if not exists iv_lab_records_interpretasi_hasil_idx
  on public.iv_lab_records (interpretasi_hasil);

insert into public.iv_lab_imports (file_name, data_year, record_count, status, created_at)
select
  'Data lama (file tidak tercatat)',
  extract(year from registration_date)::int,
  count(*)::int,
  'legacy',
  min(created_at)
from public.iv_lab_records
where import_id is null
group by extract(year from registration_date)::int
on conflict (data_year) where status = 'legacy' do nothing;

update public.iv_lab_records as record
set import_id = imported.id
from public.iv_lab_imports as imported
where record.import_id is null
  and imported.status = 'legacy'
  and imported.data_year = extract(year from record.registration_date)::int;

update public.iv_lab_imports as imported
set record_count = (
  select count(*)::int
  from public.iv_lab_records as record
  where record.import_id = imported.id
)
where imported.status = 'legacy';

alter table public.iv_lab_admins enable row level security;
alter table public.iv_lab_imports enable row level security;
alter table public.iv_lab_records enable row level security;

revoke all on public.iv_lab_admins from anon, authenticated;
revoke all on public.iv_lab_imports from anon, authenticated;
revoke all on public.iv_lab_records from anon, authenticated;
grant select on public.iv_lab_admins to authenticated;
grant select, insert, update, delete on public.iv_lab_imports to authenticated;
grant select, insert, update, delete on public.iv_lab_records to authenticated;

drop policy if exists "Admins can read their own access" on public.iv_lab_admins;
create policy "Admins can read their own access"
  on public.iv_lab_admins for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Admins can manage IV Lab imports" on public.iv_lab_imports;
create policy "Admins can manage IV Lab imports"
  on public.iv_lab_imports for all to authenticated
  using (
    exists (
      select 1 from public.iv_lab_admins
      where iv_lab_admins.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.iv_lab_admins
      where iv_lab_admins.user_id = (select auth.uid())
    )
  );

drop policy if exists "Admins can manage IV Lab records" on public.iv_lab_records;
create policy "Admins can manage IV Lab records"
  on public.iv_lab_records for all to authenticated
  using (
    exists (
      select 1 from public.iv_lab_admins
      where iv_lab_admins.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.iv_lab_admins
      where iv_lab_admins.user_id = (select auth.uid())
    )
  );

create or replace function public.public_iv_lab_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', count(*),
    'positive', count(*) filter (
      where lower(trim(interpretasi_hasil)) in (
        'positif', 'positive', 'positip',
        'seropositif', 'seropositive', 'seropositip'
      )
    ),
    'seropositive', count(*) filter (
      where lower(trim(interpretasi_hasil)) in (
        'seropositif', 'seropositive', 'seropositip'
      )
    ),
    'province_count', count(distinct provinsi),
    'by_year', coalesce((
      select jsonb_agg(jsonb_build_object('label', year, 'total', total) order by year)
      from (
        select extract(year from registration_date)::int as year, count(*) as total
        from public.iv_lab_records
        group by 1
      ) years
    ), '[]'::jsonb),
    'by_month', coalesce((
      select jsonb_agg(jsonb_build_object('label', month, 'total', total) order by month)
      from (
        select to_char(date_trunc('month', registration_date), 'YYYY-MM') as month, count(*) as total
        from public.iv_lab_records
        group by 1
        order by 1 desc
        limit 24
      ) months
    ), '[]'::jsonb),
    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'total', total) order by total desc, label)
      from (
        select metode_uji as label, count(*) as total
        from public.iv_lab_records
        group by metode_uji
        order by total desc, label
        limit 12
      ) methods
    ), '[]'::jsonb),
    'by_province', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', label,
        'total', total,
        'positive', positive,
        'seropositive', seropositive
      ) order by total desc, label)
      from (
        select
          provinsi as label,
          count(*) as total,
          count(*) filter (
            where lower(trim(interpretasi_hasil)) in (
              'positif', 'positive', 'positip',
              'seropositif', 'seropositive', 'seropositip'
            )
          ) as positive,
          count(*) filter (
            where lower(trim(interpretasi_hasil)) in (
              'seropositif', 'seropositive', 'seropositip'
            )
          ) as seropositive
        from public.iv_lab_records
        group by provinsi
      ) provinces
    ), '[]'::jsonb),
    'by_regency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'province', province,
        'label', label,
        'total', total,
        'positive', positive,
        'seropositive', seropositive
      ) order by province, label)
      from (
        select
          provinsi as province,
          kabupaten as label,
          count(*) as total,
          count(*) filter (
            where lower(trim(interpretasi_hasil)) in (
              'positif', 'positive', 'positip',
              'seropositif', 'seropositive', 'seropositip'
            )
          ) as positive,
          count(*) filter (
            where lower(trim(interpretasi_hasil)) in (
              'seropositif', 'seropositive', 'seropositip'
            )
          ) as seropositive
        from public.iv_lab_records
        where nullif(trim(kabupaten), '') is not null
        group by provinsi, kabupaten
      ) regencies
    ), '[]'::jsonb),
    'by_district', coalesce((
      select jsonb_agg(jsonb_build_object(
        'province', province,
        'regency', regency,
        'label', label,
        'total', total,
        'positive', positive,
        'seropositive', seropositive
      ) order by province, regency, label)
      from (
        select
          provinsi as province,
          kabupaten as regency,
          kecamatan as label,
          count(*) as total,
          count(*) filter (
            where lower(trim(interpretasi_hasil)) in (
              'positif', 'positive', 'positip',
              'seropositif', 'seropositive', 'seropositip'
            )
          ) as positive,
          count(*) filter (
            where lower(trim(interpretasi_hasil)) in (
              'seropositif', 'seropositive', 'seropositip'
            )
          ) as seropositive
        from public.iv_lab_records
        where nullif(trim(kabupaten), '') is not null
          and nullif(trim(kecamatan), '') is not null
        group by provinsi, kabupaten, kecamatan
      ) districts
    ), '[]'::jsonb)
  )
  from public.iv_lab_records;
$$;

create or replace function public.public_iv_lab_dashboard_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      extract(year from registration_date)::int as year,
      to_char(registration_date, 'YYYY-MM-DD') as day,
      to_char(registration_date, 'YYYY-MM') as month,
      coalesce(nullif(trim(provinsi), ''), '(kosong)') as province,
      coalesce(nullif(trim(kabupaten), ''), '') as regency,
      coalesce(nullif(trim(kecamatan), ''), '') as district,
      coalesce(nullif(trim(nama_uji), ''), '(tanpa nama uji)') as target,
      coalesce(nullif(trim(metode_uji), ''), '(kosong)') as method,
      coalesce(nullif(trim(no_registrasi), ''), '') || '|' ||
        coalesce(nullif(trim(kode_sampel), ''), id::text) as sample_id,
      regexp_replace(lower(trim(coalesce(interpretasi_hasil, ''))), '[^a-z]', '', 'g') as result
    from public.iv_lab_records
  ),
  chart_samples as (
    select 'by_method'::text as dimension, year, province, method as label, null::text as target, null::text as regency, null::text as district, sample_id,
      bool_or(result in ('positif', 'positive', 'positip')) as positive,
      bool_or(result in ('seropositif', 'seropositive', 'seropositip')) as seropositive
    from base group by year, province, method, sample_id
    union all
    select 'by_day', year, province, day, null::text, null::text, null::text, sample_id,
      bool_or(result in ('positif', 'positive', 'positip')),
      bool_or(result in ('seropositif', 'seropositive', 'seropositip'))
    from base group by year, province, day, sample_id
    union all
    select 'by_month', year, province, month, null::text, null::text, null::text, sample_id,
      bool_or(result in ('positif', 'positive', 'positip')),
      bool_or(result in ('seropositif', 'seropositive', 'seropositip'))
    from base group by year, province, month, sample_id
    union all
    select 'by_year', year, province, year::text, null::text, null::text, null::text, sample_id,
      bool_or(result in ('positif', 'positive', 'positip')),
      bool_or(result in ('seropositif', 'seropositive', 'seropositip'))
    from base group by year, province, sample_id
    union all
    select 'by_province', year, province, province, null::text, null::text, null::text, sample_id,
      bool_or(result in ('positif', 'positive', 'positip')),
      bool_or(result in ('seropositif', 'seropositive', 'seropositip'))
    from base group by year, province, sample_id
    union all
    select 'by_disease_month', year, province, month, target, null::text, null::text, sample_id,
      bool_or(result in ('positif', 'positive', 'positip')),
      bool_or(result in ('seropositif', 'seropositive', 'seropositip'))
    from base group by year, province, month, target, sample_id
    union all
    select 'by_regency_month', year, province, month, null::text, regency, null::text, sample_id,
      bool_or(result in ('positif', 'positive', 'positip')),
      bool_or(result in ('seropositif', 'seropositive', 'seropositip'))
    from base group by year, province, month, regency, sample_id
    union all
    select 'by_district_month', year, province, month, null::text, regency, district, sample_id,
      bool_or(result in ('positif', 'positive', 'positip')),
      bool_or(result in ('seropositif', 'seropositive', 'seropositip'))
    from base group by year, province, month, regency, district, sample_id
  ),
  chart_summary as (
    select dimension, year, province, label, target, regency, district,
      count(*) as total,
      count(*) filter (where positive) as positive,
      count(*) filter (where seropositive) as seropositive
    from chart_samples
    group by dimension, year, province, label, target, regency, district
  ),
  map_samples as (
    select year, province, regency, district, target, sample_id, count(*) as tests,
      bool_or(result in (
        'positif', 'positive', 'positip',
        'seropositif', 'seropositive', 'seropositip'
      )) as positive,
      bool_or(result in (
        'negatif', 'negative', 'negatip',
        'seronegatif', 'seronegative', 'seronegatip'
      )) as negative
    from base
    group by year, province, regency, district, target, sample_id
    union all
    select year, province, regency, district, null::text, sample_id, count(*) as tests,
      bool_or(result in (
        'positif', 'positive', 'positip',
        'seropositif', 'seropositive', 'seropositip'
      )),
      bool_or(result in (
        'negatif', 'negative', 'negatip',
        'seronegatif', 'seronegative', 'seronegatip'
      ))
    from base
    group by year, province, regency, district, sample_id
  ),
  map_summary as (
    select year, province, regency, district, target, sum(tests) as tests,
      count(*) as total,
      count(*) filter (where positive) as positive,
      count(*) filter (where not positive and negative) as negative,
      count(*) filter (where not positive and not negative) as other
    from map_samples
    group by year, province, regency, district, target
  )
  select jsonb_build_object(
    'charts', jsonb_build_object(
      'by_method', coalesce((
        select jsonb_agg(jsonb_build_object(
          'year', year, 'province', province, 'label', label,
          'total', total, 'positive', positive, 'seropositive', seropositive
        ) order by year, province, label)
        from chart_summary where dimension = 'by_method'
      ), '[]'::jsonb),
      'by_day', coalesce((
        select jsonb_agg(jsonb_build_object(
          'year', year, 'province', province, 'label', label,
          'total', total, 'positive', positive, 'seropositive', seropositive
        ) order by year, province, label)
        from chart_summary where dimension = 'by_day'
      ), '[]'::jsonb),
      'by_month', coalesce((
        select jsonb_agg(jsonb_build_object(
          'year', year, 'province', province, 'label', label,
          'total', total, 'positive', positive, 'seropositive', seropositive
        ) order by year, province, label)
        from chart_summary where dimension = 'by_month'
      ), '[]'::jsonb),
      'by_year', coalesce((
        select jsonb_agg(jsonb_build_object(
          'year', year, 'province', province, 'label', label,
          'total', total, 'positive', positive, 'seropositive', seropositive
        ) order by year, province)
        from chart_summary where dimension = 'by_year'
      ), '[]'::jsonb),
      'by_province', coalesce((
        select jsonb_agg(jsonb_build_object(
          'year', year, 'province', province, 'label', label,
          'total', total, 'positive', positive, 'seropositive', seropositive
        ) order by year, province)
        from chart_summary where dimension = 'by_province'
      ), '[]'::jsonb),
      'by_disease_month', coalesce((
        select jsonb_agg(jsonb_build_object(
          'year', year, 'province', province, 'label', label, 'target', target,
          'total', total, 'positive', positive, 'seropositive', seropositive
        ) order by year, province, label, target)
        from chart_summary where dimension = 'by_disease_month'
      ), '[]'::jsonb),
      'by_regency_month', coalesce((
        select jsonb_agg(jsonb_build_object(
          'year', year, 'province', province, 'label', label, 'regency', regency,
          'total', total, 'positive', positive, 'seropositive', seropositive
        ) order by year, province, label, regency)
        from chart_summary where dimension = 'by_regency_month'
      ), '[]'::jsonb),
      'by_district_month', coalesce((
        select jsonb_agg(jsonb_build_object(
          'year', year, 'province', province, 'label', label, 'regency', regency, 'district', district,
          'total', total, 'positive', positive, 'seropositive', seropositive
        ) order by year, province, label, regency, district)
        from chart_summary where dimension = 'by_district_month'
      ), '[]'::jsonb)
    ),
    'map', coalesce((
      select jsonb_agg(jsonb_build_object(
        'year', year, 'province', province, 'regency', regency, 'district', district,
        'target', target, 'tests', tests, 'total', total,
        'positive', positive, 'negative', negative, 'other', other
      ) order by year, province, regency, district, target)
      from map_summary
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.public_iv_lab_summary() from public;
grant execute on function public.public_iv_lab_summary() to anon, authenticated;

-- Perpanjang batas waktu query untuk fungsi ringkasan (5 menit)
alter function public.public_iv_lab_summary() set statement_timeout = '300000';

revoke all on function public.public_iv_lab_dashboard_data() from public;
grant execute on function public.public_iv_lab_dashboard_data() to anon, authenticated;

-- Perpanjang batas waktu query untuk fungsi dashboard (5 menit)
alter function public.public_iv_lab_dashboard_data() set statement_timeout = '300000';
