-- DMA rm_users (subscriber master in Radius Manager).

###
CREATE TABLE IF NOT EXISTS rm_users (
  username VARCHAR(64) PRIMARY KEY,
  password VARCHAR(32) NOT NULL,
  groupid INTEGER NOT NULL,
  enableuser SMALLINT NOT NULL,
  uplimit BIGINT NOT NULL,
  downlimit BIGINT NOT NULL,
  comblimit BIGINT NOT NULL,
  firstname VARCHAR(50) NOT NULL,
  lastname VARCHAR(50) NOT NULL,
  company VARCHAR(50) NOT NULL,
  phone VARCHAR(15) NOT NULL,
  mobile VARCHAR(15) NOT NULL,
  address VARCHAR(100) NOT NULL,
  city VARCHAR(50) NOT NULL,
  zip VARCHAR(8) NOT NULL,
  country VARCHAR(50) NOT NULL,
  state VARCHAR(50) NOT NULL,
  comment VARCHAR(500) NOT NULL,
  gpslat NUMERIC(17,14) NOT NULL,
  gpslong NUMERIC(17,14) NOT NULL,
  mac VARCHAR(17) NOT NULL,
  usemacauth SMALLINT NOT NULL,
  expiration TIMESTAMP NOT NULL,
  uptimelimit BIGINT NOT NULL,
  srvid INTEGER NOT NULL,
  staticipcm VARCHAR(15) NOT NULL,
  staticipcpe VARCHAR(15) NOT NULL,
  ipmodecm SMALLINT NOT NULL,
  ipmodecpe SMALLINT NOT NULL,
  poolidcm INTEGER NOT NULL,
  poolidcpe INTEGER NOT NULL,
  createdon DATE NOT NULL,
  acctype SMALLINT NOT NULL,
  credits NUMERIC(20,2) NOT NULL,
  cardfails SMALLINT NOT NULL,
  createdby VARCHAR(64) NOT NULL,
  owner VARCHAR(64) NOT NULL,
  taxid VARCHAR(40) NOT NULL,
  email VARCHAR(100) NOT NULL,
  maccm VARCHAR(17) NOT NULL,
  custattr VARCHAR(255) NOT NULL,
  warningsent SMALLINT NOT NULL,
  verifycode VARCHAR(10) NOT NULL,
  verified SMALLINT NOT NULL,
  selfreg SMALLINT NOT NULL,
  verifyfails SMALLINT NOT NULL,
  verifysentnum SMALLINT NOT NULL,
  verifymobile VARCHAR(15) NOT NULL,
  contractid VARCHAR(50) NOT NULL,
  contractvalid DATE NOT NULL,
  actcode VARCHAR(60) NOT NULL,
  pswactsmsnum SMALLINT NOT NULL,
  alertemail SMALLINT NOT NULL,
  alertsms SMALLINT NOT NULL,
  lang VARCHAR(30) NOT NULL,
  lastlogoff TIMESTAMP
);

###
CREATE INDEX IF NOT EXISTS rm_users_srvid ON rm_users (srvid);

###
CREATE INDEX IF NOT EXISTS rm_users_groupid ON rm_users (groupid);

###
CREATE INDEX IF NOT EXISTS rm_users_enableuser ON rm_users (enableuser);

###
CREATE INDEX IF NOT EXISTS rm_users_firstname ON rm_users (firstname);

###
CREATE INDEX IF NOT EXISTS rm_users_lastname ON rm_users (lastname);

###
CREATE INDEX IF NOT EXISTS rm_users_company ON rm_users (company);

###
CREATE INDEX IF NOT EXISTS rm_users_phone ON rm_users (phone);

###
CREATE INDEX IF NOT EXISTS rm_users_mobile ON rm_users (mobile);

###
CREATE INDEX IF NOT EXISTS rm_users_address ON rm_users (address);

###
CREATE INDEX IF NOT EXISTS rm_users_city ON rm_users (city);

###
CREATE INDEX IF NOT EXISTS rm_users_zip ON rm_users (zip);

###
CREATE INDEX IF NOT EXISTS rm_users_country ON rm_users (country);

###
CREATE INDEX IF NOT EXISTS rm_users_state ON rm_users (state);

###
CREATE INDEX IF NOT EXISTS rm_users_comment ON rm_users (comment);

###
CREATE INDEX IF NOT EXISTS rm_users_mac ON rm_users (mac);

###
CREATE INDEX IF NOT EXISTS rm_users_acctype ON rm_users (acctype);

###
CREATE INDEX IF NOT EXISTS rm_users_email ON rm_users (email);

###
CREATE INDEX IF NOT EXISTS rm_users_maccm ON rm_users (maccm);

###
CREATE INDEX IF NOT EXISTS rm_users_owner ON rm_users (owner);

###
CREATE INDEX IF NOT EXISTS rm_users_staticipcpe ON rm_users (staticipcpe);

###
CREATE INDEX IF NOT EXISTS rm_users_staticipcm ON rm_users (staticipcm);

###
CREATE INDEX IF NOT EXISTS rm_users_expiration ON rm_users (expiration);

###
CREATE INDEX IF NOT EXISTS rm_users_createdon ON rm_users (createdon);

###
CREATE INDEX IF NOT EXISTS rm_users_contractid ON rm_users (contractid);

###
CREATE INDEX IF NOT EXISTS rm_users_contractvalid ON rm_users (contractvalid);

###
CREATE INDEX IF NOT EXISTS rm_users_lastlogoff ON rm_users (lastlogoff);

