provider "aws" {
  region  = var.region-master
  alias   = "region-master"
}

provider "aws" {
  region  = var.region-worker
  alias   = "region-worker"
}
