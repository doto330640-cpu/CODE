-- ECM 플랫폼 서버 스키마 (Supabase / PostgreSQL)
-- 권한: owner(경영자) = 전 코스 열람·관리, manager(코스팀장) = 배정된 코스만 열람·작업 기록.
-- 모든 표에 행 단위 보안(RLS)을 켜서, 앱 코드가 아니라 DB가 접근을 막는다.

create table courses (
  id text primary key,                 -- 예: 'sejong'
  name text not null unique,           -- 예: '세종필드'
  logger text                          -- 예: 'z6-38011'
);

create table profiles (
  user_id uuid primary key references auth.users on delete cascade,
  name text not null,
  role text not null check (role in ('owner', 'manager'))
);

create table course_members (          -- 팀장이 볼 수 있는 코스
  user_id uuid references profiles on delete cascade,
  course_id text references courses on delete cascade,
  primary key (user_id, course_id)
);

create table sensors (                 -- 센서 포트 위치 (images/source 도면 기준)
  course_id text references courses on delete cascade,
  port int not null check (port between 1 and 4),   -- 4 = 기상관측기
  kind text not null check (kind in ('soil', 'weather')),
  place text,
  primary key (course_id, port)
);

create table daily_readings (          -- tools/build_platform_data.py 결과와 같은 열
  course_id text references courses on delete cascade,
  day date not null,
  tmean real, tmax real, tmin real, rain real, et0 real,
  vwc real, port1 real, port2 real, port3 real, soil_t real, ec real,
  primary key (course_id, day)
);

create table tasks (
  id bigint generated always as identity primary key,
  course_id text not null references courses on delete cascade,
  day date not null,
  title text not null check (char_length(title) <= 60),
  done boolean not null default false,
  auto boolean not null default false,
  created_by uuid not null default auth.uid() references profiles,
  updated_at timestamptz not null default now()
);

-- 권한 확인 함수
create function is_owner() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where user_id = auth.uid() and role = 'owner') $$;

create function can_see(c text) returns boolean language sql stable security definer set search_path = public as
$$ select is_owner() or exists (select 1 from course_members where user_id = auth.uid() and course_id = c) $$;

alter table courses enable row level security;
alter table profiles enable row level security;
alter table course_members enable row level security;
alter table sensors enable row level security;
alter table daily_readings enable row level security;
alter table tasks enable row level security;

create policy courses_read   on courses        for select using (can_see(id));
create policy sensors_read   on sensors        for select using (can_see(course_id));
create policy readings_read  on daily_readings for select using (can_see(course_id));
create policy profile_self   on profiles       for select using (user_id = auth.uid() or is_owner());
create policy members_read   on course_members for select using (user_id = auth.uid() or is_owner());

-- 작업: 볼 수 있는 코스에서만 읽고, 팀장은 자기 코스의 작업을 쓴다. 경영자는 읽기 전용(필요하면 아래 for all로 변경).
create policy tasks_read   on tasks for select using (can_see(course_id));
create policy tasks_insert on tasks for insert with check (can_see(course_id) and not is_owner());
create policy tasks_update on tasks for update using (can_see(course_id) and not is_owner());
create policy tasks_delete on tasks for delete using (can_see(course_id) and not is_owner() and created_by = auth.uid());

-- 센서 자료·사용자 배정 입력은 경영자(또는 서비스 키로 실행하는 수집 스크립트)만 한다. 별도 정책 없음 = 앱에서는 쓰기 불가.
