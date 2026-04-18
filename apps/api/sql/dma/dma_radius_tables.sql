-- DMA Radius Manager — MySQL `radius` schema ported to PostgreSQL (companion to SaaS tables).
-- Loaded by ensureDmaRadiusSchema(); statements separated by ### for the runner.

###
CREATE TABLE IF NOT EXISTS nas (
  id SERIAL PRIMARY KEY,
  nasname VARCHAR(128) NOT NULL,
  shortname VARCHAR(32),
  type VARCHAR(30) NOT NULL DEFAULT 'other',
  ports INTEGER,
  secret VARCHAR(60) NOT NULL DEFAULT 'secret',
  community VARCHAR(50),
  description VARCHAR(200) NOT NULL DEFAULT 'RADIUS Client',
  starospassword VARCHAR(32) NOT NULL DEFAULT '',
  ciscobwmode SMALLINT NOT NULL DEFAULT 0,
  apiusername VARCHAR(32) NOT NULL DEFAULT '',
  apipassword VARCHAR(32) NOT NULL DEFAULT '',
  enableapi SMALLINT NOT NULL DEFAULT 0
);

###
CREATE INDEX IF NOT EXISTS nas_nasname ON nas (nasname);

###
CREATE TABLE IF NOT EXISTS radgroupcheck (
  id SERIAL PRIMARY KEY,
  groupname VARCHAR(64) NOT NULL DEFAULT '',
  attribute VARCHAR(64) NOT NULL DEFAULT '',
  op CHAR(2) NOT NULL DEFAULT '==',
  value VARCHAR(253) NOT NULL DEFAULT ''
);

###
CREATE INDEX IF NOT EXISTS radgroupcheck_groupname ON radgroupcheck (groupname);

###
CREATE TABLE IF NOT EXISTS radgroupreply (
  id SERIAL PRIMARY KEY,
  groupname VARCHAR(64) NOT NULL DEFAULT '',
  attribute VARCHAR(64) NOT NULL DEFAULT '',
  op CHAR(2) NOT NULL DEFAULT '=',
  value VARCHAR(253) NOT NULL DEFAULT ''
);

###
CREATE INDEX IF NOT EXISTS radgroupreply_groupname ON radgroupreply (groupname);

###
CREATE TABLE IF NOT EXISTS radippool (
  id SERIAL PRIMARY KEY,
  pool_name VARCHAR(30) NOT NULL,
  framedipaddress VARCHAR(15) NOT NULL,
  nasipaddress VARCHAR(15) NOT NULL,
  calledstationid VARCHAR(30) NOT NULL,
  callingstationid VARCHAR(30) NOT NULL,
  expiry_time TIMESTAMP,
  username VARCHAR(64) NOT NULL,
  pool_key VARCHAR(30) NOT NULL
);

###
CREATE TABLE IF NOT EXISTS radpostauth (
  id SERIAL PRIMARY KEY,
  username VARCHAR(64) NOT NULL DEFAULT '',
  pass VARCHAR(64) NOT NULL DEFAULT '',
  reply VARCHAR(32) NOT NULL DEFAULT '',
  authdate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  nasipaddress VARCHAR(15) NOT NULL
);

###
CREATE INDEX IF NOT EXISTS radpostauth_username ON radpostauth (username);

###
CREATE INDEX IF NOT EXISTS radpostauth_authdate ON radpostauth (authdate);

###
CREATE INDEX IF NOT EXISTS radpostauth_nasip ON radpostauth (nasipaddress);

###
CREATE TABLE IF NOT EXISTS radusergroup (
  username VARCHAR(64) NOT NULL DEFAULT '',
  groupname VARCHAR(64) NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (username, groupname)
);

###
CREATE INDEX IF NOT EXISTS radusergroup_username ON radusergroup (username);

###
CREATE TABLE IF NOT EXISTS rm_actsrv (
  id BIGSERIAL PRIMARY KEY,
  datetime TIMESTAMP NOT NULL,
  username VARCHAR(64) NOT NULL,
  srvid INTEGER NOT NULL,
  dailynextsrvactive SMALLINT NOT NULL
);

###
CREATE INDEX IF NOT EXISTS rm_actsrv_datetime ON rm_actsrv (datetime);

###
CREATE INDEX IF NOT EXISTS rm_actsrv_username ON rm_actsrv (username);

###
CREATE TABLE IF NOT EXISTS rm_allowedmanagers (
  srvid INTEGER NOT NULL,
  managername VARCHAR(64) NOT NULL,
  PRIMARY KEY (srvid, managername)
);

###
CREATE INDEX IF NOT EXISTS rm_allowedmanagers_srvid ON rm_allowedmanagers (srvid);

###
CREATE INDEX IF NOT EXISTS rm_allowedmanagers_manager ON rm_allowedmanagers (managername);

###
CREATE TABLE IF NOT EXISTS rm_allowednases (
  srvid INTEGER NOT NULL,
  nasid INTEGER NOT NULL,
  PRIMARY KEY (srvid, nasid)
);

###
CREATE INDEX IF NOT EXISTS rm_allowednases_srvid ON rm_allowednases (srvid);

###
CREATE INDEX IF NOT EXISTS rm_allowednases_nasid ON rm_allowednases (nasid);

###
CREATE TABLE IF NOT EXISTS rm_ap (
  id SERIAL PRIMARY KEY,
  name VARCHAR(32) NOT NULL,
  enable SMALLINT NOT NULL,
  accessmode SMALLINT NOT NULL,
  ip VARCHAR(15) NOT NULL,
  community VARCHAR(32) NOT NULL,
  apiusername VARCHAR(32) NOT NULL,
  apipassword VARCHAR(32) NOT NULL,
  description VARCHAR(200) NOT NULL
);

###
CREATE INDEX IF NOT EXISTS rm_ap_ip ON rm_ap (ip);

###
CREATE TABLE IF NOT EXISTS rm_cards (
  id BIGINT PRIMARY KEY,
  cardnum VARCHAR(16) NOT NULL,
  password VARCHAR(8) NOT NULL,
  value NUMERIC(22,2) NOT NULL,
  expiration DATE NOT NULL,
  series VARCHAR(16) NOT NULL,
  date DATE NOT NULL,
  owner VARCHAR(64) NOT NULL,
  used TIMESTAMP NOT NULL,
  cardtype SMALLINT NOT NULL,
  revoked SMALLINT NOT NULL,
  downlimit BIGINT NOT NULL,
  uplimit BIGINT NOT NULL,
  comblimit BIGINT NOT NULL,
  uptimelimit BIGINT NOT NULL,
  srvid INTEGER NOT NULL,
  transid VARCHAR(32) NOT NULL,
  active SMALLINT NOT NULL,
  expiretime BIGINT NOT NULL,
  timebaseexp SMALLINT NOT NULL,
  timebaseonline SMALLINT NOT NULL
);

###
CREATE UNIQUE INDEX IF NOT EXISTS rm_cards_cardnum ON rm_cards (cardnum);

###
CREATE INDEX IF NOT EXISTS rm_cards_series ON rm_cards (series);

###
CREATE INDEX IF NOT EXISTS rm_cards_used ON rm_cards (used);

###
CREATE INDEX IF NOT EXISTS rm_cards_owner ON rm_cards (owner);

###
CREATE TABLE IF NOT EXISTS rm_changesrv (
  id SERIAL PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  newsrvid INTEGER NOT NULL,
  newsrvname VARCHAR(50) NOT NULL,
  scheduledate DATE NOT NULL,
  requestdate DATE NOT NULL,
  status SMALLINT NOT NULL,
  transid VARCHAR(32) NOT NULL,
  requested VARCHAR(64) NOT NULL
);

###
CREATE INDEX IF NOT EXISTS rm_changesrv_requestdate ON rm_changesrv (requestdate);

###
CREATE INDEX IF NOT EXISTS rm_changesrv_scheduledate ON rm_changesrv (scheduledate);

###
CREATE TABLE IF NOT EXISTS rm_cmts (
  id SERIAL PRIMARY KEY,
  ip VARCHAR(15) NOT NULL,
  name VARCHAR(32) NOT NULL,
  community VARCHAR(32) NOT NULL,
  descr VARCHAR(200) NOT NULL
);

###
CREATE INDEX IF NOT EXISTS rm_cmts_ip ON rm_cmts (ip);

###
CREATE TABLE IF NOT EXISTS rm_colsetlistdocsis (
  managername VARCHAR(64) NOT NULL,
  colname VARCHAR(32) NOT NULL,
  PRIMARY KEY (managername, colname)
);

###
CREATE INDEX IF NOT EXISTS rm_colsetlistdocsis_manager ON rm_colsetlistdocsis (managername);

###
CREATE TABLE IF NOT EXISTS rm_colsetlistradius (
  managername VARCHAR(64) NOT NULL,
  colname VARCHAR(32) NOT NULL,
  PRIMARY KEY (managername, colname)
);

###
CREATE INDEX IF NOT EXISTS rm_colsetlistradius_manager ON rm_colsetlistradius (managername);

###
CREATE TABLE IF NOT EXISTS rm_colsetlistusers (
  managername VARCHAR(64) NOT NULL,
  colname VARCHAR(32) NOT NULL,
  PRIMARY KEY (managername, colname)
);

###
CREATE INDEX IF NOT EXISTS rm_colsetlistusers_manager ON rm_colsetlistusers (managername);

###
CREATE TABLE IF NOT EXISTS rm_ias (
  iasid SERIAL PRIMARY KEY,
  iasname VARCHAR(50) NOT NULL,
  price NUMERIC(20,2) NOT NULL,
  downlimit BIGINT NOT NULL,
  uplimit BIGINT NOT NULL,
  comblimit BIGINT NOT NULL,
  uptimelimit BIGINT NOT NULL,
  expiretime BIGINT NOT NULL,
  timebaseonline SMALLINT NOT NULL,
  timebaseexp SMALLINT NOT NULL,
  srvid INTEGER NOT NULL,
  enableias SMALLINT NOT NULL,
  expiremode SMALLINT NOT NULL,
  expiration DATE NOT NULL,
  simuse INTEGER NOT NULL
);

###
CREATE TABLE IF NOT EXISTS rm_invoices (
  id SERIAL PRIMARY KEY,
  invgroup SMALLINT NOT NULL,
  invnum VARCHAR(16) NOT NULL,
  managername VARCHAR(64) NOT NULL,
  username VARCHAR(64) NOT NULL,
  "date" DATE NOT NULL,
  bytesdl BIGINT NOT NULL,
  bytesul BIGINT NOT NULL,
  bytescomb BIGINT NOT NULL,
  downlimit BIGINT NOT NULL,
  uplimit BIGINT NOT NULL,
  comblimit BIGINT NOT NULL,
  "time" INTEGER NOT NULL,
  uptimelimit BIGINT NOT NULL,
  days INTEGER NOT NULL,
  expiration DATE NOT NULL,
  capdl SMALLINT NOT NULL,
  capul SMALLINT NOT NULL,
  captotal SMALLINT NOT NULL,
  captime SMALLINT NOT NULL,
  capdate SMALLINT NOT NULL,
  service VARCHAR(60) NOT NULL,
  comment VARCHAR(200) NOT NULL,
  transid VARCHAR(32) NOT NULL,
  amount NUMERIC(13,2) NOT NULL,
  address VARCHAR(50) NOT NULL,
  city VARCHAR(50) NOT NULL,
  zip VARCHAR(8) NOT NULL,
  country VARCHAR(50) NOT NULL,
  state VARCHAR(50) NOT NULL,
  fullname VARCHAR(100) NOT NULL,
  taxid VARCHAR(40) NOT NULL,
  paymentopt DATE NOT NULL,
  invtype SMALLINT NOT NULL,
  paymode SMALLINT NOT NULL,
  paid DATE NOT NULL,
  price NUMERIC(25,6) NOT NULL,
  tax NUMERIC(25,6) NOT NULL,
  vatpercent NUMERIC(4,2) NOT NULL,
  remark VARCHAR(400) NOT NULL,
  balance NUMERIC(20,2) NOT NULL,
  gwtransid VARCHAR(255) NOT NULL,
  phone VARCHAR(15) NOT NULL,
  mobile VARCHAR(15) NOT NULL
);

###
CREATE INDEX IF NOT EXISTS rm_invoices_invnum ON rm_invoices (invnum);

###
CREATE INDEX IF NOT EXISTS rm_invoices_username ON rm_invoices (username);

###
CREATE INDEX IF NOT EXISTS rm_invoices_manager ON rm_invoices (managername);

###
CREATE INDEX IF NOT EXISTS rm_invoices_date ON rm_invoices ("date");

###
CREATE INDEX IF NOT EXISTS rm_invoices_gwtransid ON rm_invoices (gwtransid);

###
CREATE INDEX IF NOT EXISTS rm_invoices_comment ON rm_invoices (comment);

###
CREATE INDEX IF NOT EXISTS rm_invoices_paymode ON rm_invoices (paymode);

###
CREATE INDEX IF NOT EXISTS rm_invoices_invgroup ON rm_invoices (invgroup);

###
CREATE INDEX IF NOT EXISTS rm_invoices_paid ON rm_invoices (paid);

###
CREATE TABLE IF NOT EXISTS rm_ippools (
  id SERIAL PRIMARY KEY,
  type SMALLINT NOT NULL,
  name VARCHAR(32) NOT NULL,
  fromip VARCHAR(15) NOT NULL,
  toip VARCHAR(15) NOT NULL,
  descr VARCHAR(200) NOT NULL,
  nextpoolid INTEGER NOT NULL
);

###
CREATE INDEX IF NOT EXISTS rm_ippools_name ON rm_ippools (name);

###
CREATE INDEX IF NOT EXISTS rm_ippools_nextpool ON rm_ippools (nextpoolid);
