terraform {
  required_version = ">=0.13.0"
  backend "s3" {
    region  = "eu-west-2"
    profile = "default"
    key     = "terraformstate"
    bucket  = "terraformstatebucket1701"
  }
}
