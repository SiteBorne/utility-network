from webctx_safe_egress.security.url_validate import validate_redirect_chain, validate_url


class TestSchemeValidation:
    def test_http_allowed(self):
        assert validate_url("http://example.com/").valid

    def test_https_allowed(self):
        assert validate_url("https://example.com/").valid

    def test_ftp_rejected(self):
        assert not validate_url("ftp://example.com/").valid

    def test_file_rejected(self):
        assert not validate_url("file:///etc/passwd").valid

    def test_gopher_rejected(self):
        assert not validate_url("gopher://example.com/").valid


class TestPortValidation:
    def test_default_https_port_allowed(self):
        assert validate_url("https://example.com/").valid

    def test_ssh_port_blocked(self):
        assert not validate_url("https://example.com:22/").valid

    def test_postgres_port_blocked(self):
        assert not validate_url("https://example.com:5432/").valid

    def test_arbitrary_unlisted_port_rejected(self):
        assert not validate_url("https://example.com:8443/").valid


class TestLocalhostRejection:
    def test_localhost_rejected(self):
        assert not validate_url("http://localhost/").valid

    def test_localhost_localdomain_rejected(self):
        assert not validate_url("http://localhost.localdomain/").valid


class TestPrivateIPv4LiteralRejection:
    def test_private_ip_literal_rejected(self):
        assert not validate_url("http://10.0.0.1/").valid

    def test_loopback_literal_rejected(self):
        assert not validate_url("http://127.0.0.1/").valid

    def test_link_local_literal_rejected(self):
        assert not validate_url("http://169.254.1.1/").valid

    def test_public_ipv4_literal_accepted(self):
        assert validate_url("http://8.8.8.8/").valid


class TestIPv6LiteralRejection:
    def test_ipv6_loopback_rejected(self):
        assert not validate_url("http://[::1]/").valid

    def test_ipv6_ula_rejected(self):
        assert not validate_url("http://[fd00::1]/").valid

    def test_ipv6_link_local_rejected(self):
        assert not validate_url("http://[fe80::1]/").valid

    def test_public_ipv6_accepted(self):
        assert validate_url("http://[2606:4700::1111]/").valid


class TestIPv4MappedIPv6InUrl:
    def test_mapped_private_rejected(self):
        assert not validate_url("http://[::ffff:127.0.0.1]/").valid

    def test_mapped_public_accepted(self):
        assert validate_url("http://[::ffff:8.8.8.8]/").valid


class TestOrdinaryPublicHostname:
    def test_ordinary_hostname_accepted(self):
        assert validate_url("https://example.com/some/path?q=1").valid


class TestRedirectChain:
    def test_within_limit_accepted(self):
        urls = [f"https://example.com/{i}" for i in range(5)]
        assert validate_redirect_chain(urls).valid

    def test_exceeds_max_redirects_rejected(self):
        urls = [f"https://example.com/{i}" for i in range(11)]
        assert not validate_redirect_chain(urls).valid

    def test_loop_detected(self):
        urls = ["https://example.com/a", "https://example.com/b", "https://example.com/a"]
        assert not validate_redirect_chain(urls).valid

    def test_redirect_to_private_target_rejected(self):
        urls = ["https://example.com/", "http://127.0.0.1/"]
        result = validate_redirect_chain(urls)
        assert not result.valid
        assert "Loopback" in (result.reason or "") or "invalid" in (result.reason or "")
