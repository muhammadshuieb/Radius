-- Continuation: DMA rm_* tables (split for maintainability). Loaded after dma_radius_tables.sql.

###
CREATE TABLE IF NOT EXISTS rm_managers (
  managername VARCHAR(64) PRIMARY KEY,
  password VARCHAR(32) NOT NULL,
  firstname VARCHAR(50) NOT NULL,
  lastname VARCHAR(50) NOT NULL,
  phone VARCHAR(15) NOT NULL,
  mobile VARCHAR(15) NOT NULL,
  address VARCHAR(50) NOT NULL,
  city VARCHAR(50) NOT NULL,
  zip VARCHAR(8) NOT NULL,
  country VARCHAR(50) NOT NULL,
  state VARCHAR(50) NOT NULL,
  comment VARCHAR(200) NOT NULL,
  company VARCHAR(50) NOT NULL,
  vatid VARCHAR(40) NOT NULL,
  email VARCHAR(50) NOT NULL,
  balance NUMERIC(20,2) NOT NULL,
  perm_listusers SMALLINT NOT NULL,
  perm_createusers SMALLINT NOT NULL,
  perm_editusers SMALLINT NOT NULL,
  perm_edituserspriv SMALLINT NOT NULL,
  perm_deleteusers SMALLINT NOT NULL,
  perm_listmanagers SMALLINT NOT NULL,
  perm_createmanagers SMALLINT NOT NULL,
  perm_editmanagers SMALLINT NOT NULL,
  perm_deletemanagers SMALLINT NOT NULL,
  perm_listservices SMALLINT NOT NULL,
  perm_createservices SMALLINT NOT NULL,
  perm_editservices SMALLINT NOT NULL,
  perm_deleteservices SMALLINT NOT NULL,
  perm_listonlineusers SMALLINT NOT NULL,
  perm_listinvoices SMALLINT NOT NULL,
  perm_trafficreport SMALLINT NOT NULL,
  perm_addcredits SMALLINT NOT NULL,
  perm_negbalance SMALLINT NOT NULL,
  perm_listallinvoices SMALLINT NOT NULL,
  perm_showinvtotals SMALLINT NOT NULL,
  perm_logout SMALLINT NOT NULL,
  perm_cardsys SMALLINT NOT NULL,
  perm_editinvoice SMALLINT NOT NULL,
  perm_allusers SMALLINT NOT NULL,
  perm_allowdiscount SMALLINT NOT NULL,
  perm_enwriteoff SMALLINT NOT NULL,
  perm_accessap SMALLINT NOT NULL,
  perm_cts SMALLINT NOT NULL,
  enablemanager SMALLINT NOT NULL,
  lang VARCHAR(30) NOT NULL
);

###
CREATE TABLE IF NOT EXISTS rm_newusers (
  id SERIAL PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  firstname VARCHAR(50) NOT NULL,
  lastname VARCHAR(50) NOT NULL,
  address VARCHAR(100) NOT NULL,
  city VARCHAR(50) NOT NULL,
  zip VARCHAR(8) NOT NULL,
  country VARCHAR(50) NOT NULL,
  state VARCHAR(50) NOT NULL,
  phone VARCHAR(15) NOT NULL,
  mobile VARCHAR(15) NOT NULL,
  email VARCHAR(100) NOT NULL,
  vatid VARCHAR(40) NOT NULL,
  srvid INTEGER NOT NULL,
  actcode VARCHAR(10) NOT NULL,
  actcount INTEGER NOT NULL,
  lang VARCHAR(30) NOT NULL
);

###
CREATE TABLE IF NOT EXISTS rm_onlinecm (
  username VARCHAR(64) PRIMARY KEY,
  maccm VARCHAR(17),
  enableuser SMALLINT,
  staticipcm VARCHAR(15),
  maccpe VARCHAR(17),
  ipcpe VARCHAR(15),
  ipmodecpe SMALLINT,
  cmtsid INTEGER,
  groupid INTEGER,
  groupname VARCHAR(50),
  snrds NUMERIC(11,1),
  snrus NUMERIC(11,1),
  txpwr NUMERIC(11,1),
  rxpwr NUMERIC(11,1),
  pingtime NUMERIC(11,1),
  upstreamname VARCHAR(50),
  ifidx INTEGER,
  "timestamp" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

###
CREATE INDEX IF NOT EXISTS rm_onlinecm_maccm ON rm_onlinecm (maccm);

###
CREATE INDEX IF NOT EXISTS rm_onlinecm_staticipcm ON rm_onlinecm (staticipcm);

###
CREATE INDEX IF NOT EXISTS rm_onlinecm_ipcpe ON rm_onlinecm (ipcpe);

###
CREATE INDEX IF NOT EXISTS rm_onlinecm_groupname ON rm_onlinecm (groupname);

###
CREATE TABLE IF NOT EXISTS rm_phpsess (
  id SERIAL PRIMARY KEY,
  managername VARCHAR(64) NOT NULL,
  ip VARCHAR(15) NOT NULL,
  sessid VARCHAR(64) NOT NULL,
  lastact TIMESTAMP NOT NULL,
  closed SMALLINT NOT NULL
);

###
CREATE INDEX IF NOT EXISTS rm_phpsess_manager ON rm_phpsess (managername);

###
CREATE TABLE IF NOT EXISTS rm_radacct (
  id BIGSERIAL PRIMARY KEY,
  radacctid BIGINT NOT NULL,
  acctuniqueid VARCHAR(32) NOT NULL,
  username VARCHAR(64) NOT NULL,
  acctstarttime TIMESTAMP NOT NULL,
  acctstoptime TIMESTAMP NOT NULL,
  acctsessiontime INTEGER NOT NULL,
  acctsessiontimeratio NUMERIC(3,2) NOT NULL,
  dlbytesstart BIGINT NOT NULL,
  dlbytesstop BIGINT NOT NULL,
  dlbytes BIGINT NOT NULL,
  dlratio NUMERIC(3,2) NOT NULL,
  ulbytesstart BIGINT NOT NULL,
  ulbytesstop BIGINT NOT NULL,
  ulbytes BIGINT NOT NULL,
  ulratio NUMERIC(3,2) NOT NULL
);

###
CREATE INDEX IF NOT EXISTS rm_radacct_acctuniqueid ON rm_radacct (acctuniqueid);

###
CREATE INDEX IF NOT EXISTS rm_radacct_username ON rm_radacct (username);

###
CREATE INDEX IF NOT EXISTS rm_radacct_acctstarttime ON rm_radacct (acctstarttime);

###
CREATE INDEX IF NOT EXISTS rm_radacct_acctstoptime ON rm_radacct (acctstoptime);

###
CREATE INDEX IF NOT EXISTS rm_radacct_radacctid ON rm_radacct (radacctid);

###
CREATE TABLE IF NOT EXISTS rm_specperacnt (
  id SERIAL PRIMARY KEY,
  srvid INTEGER NOT NULL,
  starttime TIME NOT NULL,
  endtime TIME NOT NULL,
  timeratio NUMERIC(3,2) NOT NULL,
  dlratio NUMERIC(3,2) NOT NULL,
  ulratio NUMERIC(3,2) NOT NULL,
  connallowed SMALLINT NOT NULL,
  mon SMALLINT NOT NULL,
  tue SMALLINT NOT NULL,
  wed SMALLINT NOT NULL,
  thu SMALLINT NOT NULL,
  fri SMALLINT NOT NULL,
  sat SMALLINT NOT NULL,
  sun SMALLINT NOT NULL
);

###
CREATE INDEX IF NOT EXISTS rm_specperacnt_srvid ON rm_specperacnt (srvid);

###
CREATE INDEX IF NOT EXISTS rm_specperacnt_starttime ON rm_specperacnt (starttime);

###
CREATE INDEX IF NOT EXISTS rm_specperacnt_endtime ON rm_specperacnt (endtime);

###
CREATE TABLE IF NOT EXISTS rm_specperbw (
  id SERIAL PRIMARY KEY,
  srvid INTEGER NOT NULL,
  starttime TIME NOT NULL,
  endtime TIME NOT NULL,
  dlrate INTEGER NOT NULL,
  ulrate INTEGER NOT NULL,
  dlburstlimit INTEGER NOT NULL,
  ulburstlimit INTEGER NOT NULL,
  dlburstthreshold INTEGER NOT NULL,
  ulburstthreshold INTEGER NOT NULL,
  dlbursttime INTEGER NOT NULL,
  ulbursttime INTEGER NOT NULL,
  enableburst SMALLINT NOT NULL,
  priority INTEGER NOT NULL,
  mon SMALLINT NOT NULL,
  tue SMALLINT NOT NULL,
  wed SMALLINT NOT NULL,
  thu SMALLINT NOT NULL,
  fri SMALLINT NOT NULL,
  sat SMALLINT NOT NULL,
  sun SMALLINT NOT NULL
);

###
CREATE TABLE IF NOT EXISTS rm_syslog (
  id SERIAL PRIMARY KEY,
  datetime TIMESTAMP NOT NULL,
  ip VARCHAR(15) NOT NULL,
  name VARCHAR(64) NOT NULL,
  eventid INTEGER NOT NULL,
  data1 VARCHAR(64) NOT NULL
);

###
CREATE TABLE IF NOT EXISTS rm_usergroups (
  groupid SERIAL PRIMARY KEY,
  groupname VARCHAR(50) NOT NULL,
  descr VARCHAR(200) NOT NULL
);

###
CREATE INDEX IF NOT EXISTS rm_usergroups_groupname ON rm_usergroups (groupname);

###
CREATE TABLE IF NOT EXISTS rm_wlan (
  id SERIAL PRIMARY KEY,
  maccpe VARCHAR(17),
  signal SMALLINT,
  ccq SMALLINT,
  snr SMALLINT,
  apip VARCHAR(15),
  "timestamp" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

###
CREATE INDEX IF NOT EXISTS rm_wlan_maccpe ON rm_wlan (maccpe);
