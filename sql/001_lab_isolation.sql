\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF current_database() <> 'zt_security_lab' THEN
    RAISE EXCEPTION 'Este script solo puede ejecutarse en zt_security_lab';
  END IF;
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE TABLE public.transacciones (
  id integer PRIMARY KEY,
  organizacion_id integer NOT NULL CHECK (organizacion_id > 0),
  sucursal_id integer NOT NULL CHECK (sucursal_id > 0),
  monto numeric(12,2) NOT NULL CHECK (monto > 0),
  fecha timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO public.transacciones
  (id, organizacion_id, sucursal_id, monto)
VALUES
  (101, 1, 10, 1500.00),
  (102, 1,  5, 2500.00),
  (201, 2, 10, 3500.00),
  (202, 2,  5, 4500.00);

ALTER TABLE public.transacciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transacciones FORCE ROW LEVEL SECURITY;

CREATE POLICY aislamiento_organizacion
ON public.transacciones
AS RESTRICTIVE
FOR SELECT
TO zt_lab_app
USING (
  organizacion_id =
  NULLIF(current_setting('app.current_organizacion', true), '')::integer
);

CREATE POLICY lectura_por_rol
ON public.transacciones
FOR SELECT
TO zt_lab_app
USING (
  current_setting('app.current_rol', true) = 'auditor_regional'
  OR (
    current_setting('app.current_rol', true)
      IN ('gerente_sucursal', 'cajero')
    AND sucursal_id =
      NULLIF(current_setting('app.current_sucursal', true), '')::integer
  )
);

GRANT USAGE ON SCHEMA public TO zt_lab_app;
GRANT SELECT ON public.transacciones TO zt_lab_app;

COMMIT;
