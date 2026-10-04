\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  ids integer[];
BEGIN
  IF current_database() <> 'zt_security_lab'
     OR current_user <> 'zt_lab_app' THEN
    RAISE EXCEPTION 'Ejecutar solo en el laboratorio como zt_lab_app';
  END IF;

  -- Sin contexto no debe verse ningún registro.
  PERFORM set_config('app.current_organizacion', '', true);
  PERFORM set_config('app.current_rol', '', true);
  PERFORM set_config('app.current_sucursal', '', true);

  IF EXISTS (SELECT 1 FROM public.transacciones) THEN
    RAISE EXCEPTION 'FALLO: acceso sin contexto';
  END IF;
  RAISE NOTICE 'OK: sin contexto no hay acceso';

  -- Gerente de organización 1, sucursal 10.
  PERFORM set_config('app.current_organizacion', '1', true);
  PERFORM set_config('app.current_rol', 'gerente_sucursal', true);
  PERFORM set_config('app.current_sucursal', '10', true);

  SELECT array_agg(id ORDER BY id) INTO ids
  FROM public.transacciones;

  IF ids IS DISTINCT FROM ARRAY[101] THEN
    RAISE EXCEPTION 'FALLO gerente organización 1: %', ids;
  END IF;
  RAISE NOTICE 'OK: gerente organización 1 solo ve 101';

  -- Auditor de organización 1: ambas sucursales, solo su organización.
  PERFORM set_config('app.current_rol', 'auditor_regional', true);

  SELECT array_agg(id ORDER BY id) INTO ids
  FROM public.transacciones;

  IF ids IS DISTINCT FROM ARRAY[101,102] THEN
    RAISE EXCEPTION 'FALLO auditor organización 1: %', ids;
  END IF;
  RAISE NOTICE 'OK: auditor organización 1 solo ve 101 y 102';

  -- Auditor de organización 2.
  PERFORM set_config('app.current_organizacion', '2', true);

  SELECT array_agg(id ORDER BY id) INTO ids
  FROM public.transacciones;

  IF ids IS DISTINCT FROM ARRAY[201,202] THEN
    RAISE EXCEPTION 'FALLO auditor organización 2: %', ids;
  END IF;
  RAISE NOTICE 'OK: auditor organización 2 solo ve 201 y 202';

  -- Intento de consultar directamente un ID de otra organización.
  IF EXISTS (SELECT 1 FROM public.transacciones WHERE id = 101) THEN
    RAISE EXCEPTION 'FALLO: acceso directo a una transacción ajena';
  END IF;
  RAISE NOTICE 'OK: consulta directa de ID ajeno bloqueada';

  -- Un rol desconocido tampoco debe acceder.
  PERFORM set_config('app.current_rol', 'rol_desconocido', true);

  IF EXISTS (SELECT 1 FROM public.transacciones) THEN
    RAISE EXCEPTION 'FALLO: acceso con rol desconocido';
  END IF;
  RAISE NOTICE 'OK: rol desconocido sin acceso';
END
$$;

ROLLBACK;
