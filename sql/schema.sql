CREATE TABLE cell_towers (
  id BIGSERIAL PRIMARY KEY,
  radio TEXT NOT NULL,
  mcc SMALLINT NOT NULL,
  mnc SMALLINT NOT NULL,
  lac INTEGER NOT NULL,
  cell_id BIGINT NOT NULL,
  unit INTEGER NOT NULL DEFAULT -1,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  range_m INTEGER,
  samples INTEGER,
  source_updated_at TIMESTAMP,
  imported_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_cell_towers_key UNIQUE (mcc, mnc, lac, cell_id, unit)
);

CREATE INDEX idx_cell_towers_lat ON cell_towers(lat);
CREATE INDEX idx_cell_towers_lon ON cell_towers(lon);
CREATE INDEX idx_cell_towers_mnc ON cell_towers(mnc);

CREATE TABLE signal_reports (
  id BIGSERIAL PRIMARY KEY,
  operator_id SMALLINT NOT NULL REFERENCES operators(id),
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  accuracy_m REAL,
  signal_bars SMALLINT NOT NULL CHECK (signal_bars BETWEEN 0 AND 4),
  technology TEXT,
  note TEXT,
  client_ip_hash TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_signal_reports_geo ON signal_reports(lat, lon);
CREATE INDEX idx_signal_reports_operator_time ON signal_reports(operator_id, created_at);
CREATE INDEX idx_signal_reports_ip_time ON signal_reports(client_ip_hash, created_at);
